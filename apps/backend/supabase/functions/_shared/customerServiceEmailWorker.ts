import type { serviceClient } from "./supabase.ts";
import { extractCustomerServiceEmailImport } from "./customerServiceEmailExtraction.ts";
import type { AnalyzedImportSource } from "./customerServiceEmailAnalysis.ts";
import type { EmailImportExtractor } from "./mistralEmailImport.ts";
import type { GraphImageCredentials } from "./customerServiceGraphImageSource.ts";
import {
  EmailImportContinuation,
  EmailImportSourceFailure,
  isTransientEmailImportError,
} from "./customerServiceEmailRuntime.ts";

type WorkerClient = ReturnType<typeof serviceClient>;

// One import per invocation. Large multi-source emails continue via durable
// checkpoints on subsequent invocations, not recursive calls or browser memory.
export async function processCustomerServiceEmailImport(
  admin: WorkerClient,
  options: {
    importId?: string;
    apiKey?: string;
    extractor?: EmailImportExtractor;
    fetcher?: typeof fetch;
    today?: string;
    now?: () => number;
    budgetMs?: number;
    graphCredentials?: GraphImageCredentials;
    graphFetcher?: typeof fetch;
  } = {},
) {
  const now = options.now ?? (() => performance.now());
  const deadline = now() + (options.budgetMs ?? 90_000);
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw error;
    return data;
  }
  const claim = await rpc("claim_customer_service_email_import_v2", {
    p_import_id: options.importId ?? null,
  });
  if (claim === null) {
    return {
      importId: options.importId ?? null,
      requestId: null,
      status: "IDLE",
    };
  }
  if (claim.requestId != null) return claim;
  if (
    !claim.importId || !claim.workerToken ||
    !Array.isArray(claim.checkpoint?.sources)
  ) {
    throw new Error("Invalid worker claim response.");
  }
  const identity = {
    p_import_id: claim.importId,
    p_worker_token: claim.workerToken,
  };
  async function finish(
    action: string,
    code: string | null,
    retryAfterSeconds: number,
  ) {
    const result = await rpc("finish_customer_service_email_worker_v2", {
      ...identity,
      p_action: action,
      p_code: code,
      p_retry_after_seconds: retryAfterSeconds,
    });
    if (
      !result?.status ||
      result.status === "PROCESSED" && result.requestId == null
    ) {
      throw new Error("Worker completion was not confirmed.");
    }
    return result;
  }
  let action: "COMMIT" | "CONTINUE" | "RETRY" | "ATTENTION";
  let code: string | null = null;
  let retryAfterSeconds = 0;
  try {
    const result = await extractCustomerServiceEmailImport(
      admin,
      claim.importId,
      {
        apiKey: options.apiKey,
        extractor: options.extractor,
        fetcher: options.fetcher,
        today: options.today,
        workerToken: claim.workerToken,
        checkpoint: claim.checkpoint.sources as AnalyzedImportSource[],
        graphCredentials: options.graphCredentials,
        graphFetcher: options.graphFetcher,
        graphDeadline: Date.now() + Math.max(0, deadline - now()),
        beforeSource: async () => {
          // Leave room for an inference call and durable completion/cleanup.
          if (deadline - now() < 55_000) throw new EmailImportContinuation();
          await rpc("renew_customer_service_email_worker", identity);
        },
        onSource: async (source) => {
          await rpc("checkpoint_customer_service_email_worker", {
            ...identity,
            p_source: source,
          });
          // Stop on failure rather than yielding a long failed email forever.
          // Retain its sanitized source error, but only successes are reusable.
          if (source.status === "FAILED") {
            throw new EmailImportSourceFailure(
              source.error?.retryable === true,
              source.error?.code ?? "ANALYSIS_FAILED",
              source.error?.retryAfterSeconds ?? 0,
            );
          }
        },
      },
    );
    if (result.requestId !== null) action = "COMMIT";
    else if (!result.report) throw new Error("Analysis was not retained.");
    else if (result.report.outcome === "READY_FOR_INTAKE") action = "COMMIT";
    else {
      const failures = result.report.sources.filter((source) =>
        source.status === "FAILED"
      );
      action = failures.length && failures.every((source) =>
          source.error?.retryable === true
        )
        ? "RETRY"
        : "ATTENTION";
      code = failures.length ? "ANALYSIS_FAILED" : "ANALYSIS_INCOMPLETE";
    }
  } catch (error) {
    if ((error as { code?: string })?.code === "55000") {
      // A stale execution must not overwrite the result of its replacement.
      return {
        importId: claim.importId,
        requestId: null,
        status: "LEASE_LOST",
      };
    }
    if (error instanceof EmailImportSourceFailure) {
      retryAfterSeconds = error.retryAfterSeconds;
      action = error.retryable ? "RETRY" : "ATTENTION";
      code = error.code === "SOURCE_UNAVAILABLE"
        ? "SOURCE_UNAVAILABLE"
        : "ANALYSIS_FAILED";
    } else if (error instanceof EmailImportContinuation) {
      action = "CONTINUE";
      retryAfterSeconds = error.retryAfterSeconds;
    } else {
      action = isTransientEmailImportError(error) ? "RETRY" : "ATTENTION";
      code = "WORKER_ERROR";
    }
  }
  // Completion errors propagate. A network timeout may hide a committed result;
  // the next invocation reconciles via the import identity, never creates anew.
  return await finish(action, code, retryAfterSeconds);
}

async function secretsMatch(left: string, right: string) {
  const encoder = new TextEncoder();
  const digests = await Promise.all(
    [left, right].map((value) =>
      crypto.subtle.digest("SHA-256", encoder.encode(value))
    ),
  );
  const a = new Uint8Array(digests[0]);
  const b = new Uint8Array(digests[1]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function createCustomerServiceEmailWorkerHandler(options: {
  secret: string;
  enabled: boolean;
  hasProviderKey: boolean;
  run: (importId?: string) => Promise<unknown>;
}) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, code: string) =>
      Response.json({ error: code }, { status });
    if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
    const secret = options.secret.trim();
    if (secret.length < 32) return reply(503, "WORKER_NOT_CONFIGURED");
    const supplied =
      request.headers.get("x-valtrim-email-worker-secret")?.trim() ?? "";
    if (
      !supplied || supplied.length > 512 ||
      !await secretsMatch(secret, supplied)
    ) return reply(401, "UNAUTHORIZED");
    if (!options.enabled) return reply(409, "WORKER_DISABLED");
    if (!options.hasProviderKey) return reply(503, "PROVIDER_NOT_CONFIGURED");
    let importId: string | undefined;
    try {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 1024) {
              await reader.cancel();
              return reply(413, "BODY_TOO_LARGE");
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const body = length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
      if (
        !body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => key !== "importId") ||
        body.importId !== undefined &&
          (typeof body.importId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
              .test(body.importId))
      ) {
        return reply(400, "INVALID_INPUT");
      }
      importId = body.importId;
    } catch {
      return reply(400, "INVALID_INPUT");
    }
    try {
      return Response.json(await options.run(importId));
    } catch {
      return reply(503, "WORKER_EXECUTION_NOT_CONFIRMED");
    }
  };
}
