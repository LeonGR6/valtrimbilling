import {
  EmailAttachmentValidationError,
  type EmailImportAttachment,
  type ImportSourceResult,
} from "./customerServiceEmailAttachments.ts";
import {
  type createCustomerServiceEmailConnectionRepository,
  type EmailConnectionIdentity,
  type EmailConnectionState,
} from "./customerServiceEmailConnection.ts";
import {
  type createCustomerServiceMicrosoftGraph,
  type GraphAttachmentMetadata,
  graphEmailSource,
  type GraphMessage,
  MicrosoftGraphSyncError,
} from "./customerServiceMicrosoftGraph.ts";
import type { EmailSourceRecoveryInput } from "./customerServiceEmailSourceRecovery.ts";
import type { GraphSourceResult } from "./customerServiceGraphSourceStorage.ts";

export type EmailSyncReceipt = {
  importId: string;
  sourceStatus: string;
  status: string;
  requestId: number | null;
  source: Record<string, unknown>;
  manifest: Record<string, unknown>[] | null;
  sourceContractVersion: 1 | 2;
  sourceConnectionId: string | null;
};
export type EmailSyncSourcePort = {
  register: (
    target: EmailConnectionIdentity,
    message: GraphMessage,
  ) => Promise<EmailSyncReceipt>;
  retain: (
    importId: string,
    source: Record<string, unknown>,
    files: EmailImportAttachment[],
    connection: EmailConnectionState,
    contractVersion: 1 | 2,
  ) => Promise<ImportSourceResult | GraphSourceResult>;
  reject: (
    importId: string,
    code: string,
    message: string,
  ) => Promise<ImportSourceResult>;
  failPinned: (
    importId: string,
    reason?: "LEGACY_IMAGES",
  ) => Promise<ImportSourceResult>;
};
type Connections = ReturnType<
  typeof createCustomerServiceEmailConnectionRepository
>;
type Graph = Omit<
  ReturnType<typeof createCustomerServiceMicrosoftGraph>,
  "folderMessageIds"
>;
export type EmailSyncResult = {
  status:
    | "IDLE"
    | "NEEDS_RECONCILIATION"
    | "PAGE_RETAINED"
    | "ROUND_COMPLETE"
    | "FAILED"
    | "LEASE_LOST"
    | "UNCONFIRMED"
    | "SOURCE_RECOVERED"
    | "RECOVERY_REJECTED"
    | "RECOVERY_CONFLICT";
  connectionId: string;
  retained: number;
  replayed: number;
  removed: number;
  baselineSkipped: number;
  resolvedSkipped?: number;
  importIds: string[];
  errorCode?: string;
  retryAfterSeconds?: number;
};

function durable(result: Pick<ImportSourceResult, "sourceStatus" | "status">) {
  return ["AVAILABLE", "REJECTED", "LEGACY"].includes(result.sourceStatus) ||
    result.status === "NEEDS_ATTENTION";
}

// One complete Graph page per invocation. No cursor moves for a partially
// delivered page. A replay reads an existing immutable source/problem instead of
// re-reading edits in Outlook or changing a request reviewed by a person.
export async function syncCustomerServiceEmailPage(options: {
  connectionId: string;
  connections: Connections;
  graph: Graph;
  sources: EmailSyncSourcePort;
  now?: () => number;
  deadline?: number;
}): Promise<EmailSyncResult> {
  const { connectionId, connections, graph, sources } = options;
  const now = options.now ?? Date.now;
  const result: EmailSyncResult = {
    status: "IDLE",
    connectionId,
    retained: 0,
    replayed: 0,
    removed: 0,
    baselineSkipped: 0,
    importIds: [],
  };
  const configured = await connections.read(connectionId);
  if (configured.tenant_id.toLowerCase() !== graph.tenantId) {
    throw new MicrosoftGraphSyncError("AUTH_FAILED");
  }
  if (!configured.enabled) return result;
  if (configured.last_error_code === "CURSOR_EXPIRED") {
    return {
      ...result,
      status: "NEEDS_RECONCILIATION",
      errorCode: "CURSOR_EXPIRED",
    };
  }
  if (
    configured.retry_not_before &&
    Date.parse(configured.retry_not_before) > now()
  ) {
    return {
      ...result,
      retryAfterSeconds: Math.ceil(
        (Date.parse(configured.retry_not_before) - now()) / 1000,
      ),
    };
  }
  let claimed = await connections.claim(connectionId);
  if (!claimed) return result;
  const target: EmailConnectionIdentity = {
    tenantId: claimed.tenant_id,
    mailboxId: claimed.mailbox_id,
    folderId: claimed.folder_id,
  };
  let checkpointAttempted = false;
  try {
    const page = await graph.page(
      target,
      claimed.cursor_kind
        ? { kind: claimed.cursor_kind, url: claimed.cursor_url! }
        : null,
    );
    const baseline = claimed.initial_sync_mode === "BASELINE_ONLY" &&
      claimed.initialized_at === null;
    const messages = new Map<string, GraphMessage>();
    const removedIds = new Set<string>();
    for (const message of page.messages) {
      if (message["@removed"]) {
        result.removed++;
        removedIds.add(message.id);
      } else messages.set(message.id, message);
    }
    const historical = new Set(
      !baseline && messages.size
        ? await connections.baselineMatches(claimed, [...messages.keys()])
        : [],
    );
    const resolved = new Set(
      !baseline && messages.size
        ? await connections.resolvedMatches(claimed, [...messages.keys()])
        : [],
    );
    for (const message of messages.values()) {
      // Unlike baseline exclusions, a human-confirmed link survives removal
      // and re-entry of this same immutable message. SQL verifies its target.
      if (resolved.has(message.id)) {
        result.resolvedSkipped = (result.resolvedSkipped ?? 0) + 1;
        continue;
      }
      if (
        baseline || historical.has(message.id) && !removedIds.has(message.id)
      ) {
        result.baselineSkipped++;
        continue;
      }
      if (now() >= (options.deadline ?? Infinity)) {
        throw new MicrosoftGraphSyncError("SYNC_INTERRUPTED");
      }
      const receipt = await sources.register(target, message);
      if (
        ["AVAILABLE", "REJECTED", "LEGACY"].includes(receipt.sourceStatus) ||
        receipt.requestId !== null || receipt.status === "NEEDS_ATTENTION"
      ) {
        result.replayed++;
        result.importIds.push(receipt.importId);
        continue;
      }
      let retained: ImportSourceResult | GraphSourceResult;
      try {
        if (
          receipt.manifest !== null && receipt.sourceContractVersion === 1 &&
          receipt.manifest.some((file) => file.mimeType !== "application/pdf")
        ) {
          // Never create new image objects/links as a compatibility fallback.
          retained = await sources.failPinned(
            receipt.importId,
            "LEGACY_IMAGES",
          );
          if (retained.importId !== receipt.importId || !durable(retained)) {
            throw new Error("Historical source problem was not confirmed.");
          }
          result.retained++;
          result.importIds.push(receipt.importId);
          continue;
        }
        if (
          receipt.sourceContractVersion === 2 &&
          receipt.sourceConnectionId !== claimed.id
        ) {
          throw new EmailAttachmentValidationError(
            "SOURCE_METADATA",
            "The source belongs to another email connection and requires review.",
          );
        }
        let source: Record<string, unknown>;
        let metadata: GraphAttachmentMetadata[];
        if (receipt.manifest !== null) {
          // Resume an interrupted, already pinned snapshot. Never replace it
          // with a newer body/filename/list read from the provider.
          source = { ...receipt.source };
          delete source.attachments;
          metadata = receipt.manifest.map((file) => ({
            id: file.attachmentId as string,
            name: file.originalFilename as string,
            contentType: file.mimeType as string,
            size: file.sizeBytes as number,
            isInline: file.isInline as boolean,
            contentId: file.contentId as string | null,
            "@odata.type": "#microsoft.graph.fileAttachment",
          }));
        } else {
          const fullMessage = await graph.message(target, message.id);
          source = graphEmailSource(fullMessage);
          metadata = await graph.attachments(target, message.id);
        }
        const files = await graph.files(target, message.id, metadata);
        retained = await sources.retain(
          receipt.importId,
          source,
          files,
          claimed,
          receipt.manifest === null ? 2 : receipt.sourceContractVersion,
        );
      } catch (error) {
        if (!(error instanceof EmailAttachmentValidationError)) throw error;
        retained = receipt.manifest === null
          ? await sources.reject(receipt.importId, error.code, error.message)
          : await sources.failPinned(receipt.importId);
      }
      if (retained.importId !== receipt.importId || !durable(retained)) {
        throw new MicrosoftGraphSyncError("SYNC_ERROR");
      }
      result.retained++;
      result.importIds.push(receipt.importId);
    }
    checkpointAttempted = true;
    claimed = await connections.checkpoint(
      claimed,
      page.cursor,
      result.importIds,
      baseline ? [...messages.keys()] : [],
      [...removedIds],
    );
    // A NEXT checkpoint retains the cursor; release its lease for the next
    // explicit invocation. A DELTA checkpoint already releases/completes it.
    if (page.cursor.kind === "NEXT") await connections.finish(claimed);
    return {
      ...result,
      status: page.cursor.kind === "DELTA" ? "ROUND_COMPLETE" : "PAGE_RETAINED",
    };
  } catch (error) {
    const sqlCode = (error as { code?: string })?.code;
    if (sqlCode === "55000" || sqlCode === "40001") {
      return { ...result, status: "LEASE_LOST" };
    }
    // A lost checkpoint/finish response may hide committed progress. Reconcile
    // by reading on the next call; never repeat a mutation with a guessed version.
    if (checkpointAttempted) return { ...result, status: "UNCONFIRMED" };
    const failure = error instanceof MicrosoftGraphSyncError
      ? error
      : new MicrosoftGraphSyncError("SYNC_ERROR");
    try {
      await connections.defer(claimed, failure.code, failure.retryAfterSeconds);
    } catch (finishError) {
      if (
        ["55000", "40001"].includes(
          String((finishError as { code?: string })?.code),
        )
      ) return { ...result, status: "LEASE_LOST" };
      return { ...result, status: "UNCONFIRMED" };
    }
    return {
      ...result,
      status: failure.code === "CURSOR_EXPIRED"
        ? "NEEDS_RECONCILIATION"
        : "FAILED",
      errorCode: failure.code,
      retryAfterSeconds: failure.retryAfterSeconds,
    };
  }
}

export function createCustomerServiceEmailSyncHandler(options: {
  secret: string;
  enabled: boolean;
  credentialsConfigured: boolean;
  run: (connectionId: string) => Promise<EmailSyncResult>;
  recover?: (
    connectionId: string,
    input: EmailSourceRecoveryInput,
  ) => Promise<EmailSyncResult>;
}) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, error: string) =>
      Response.json({ error }, { status });
    if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
    const secret = options.secret.trim();
    if (secret.length < 32) return reply(503, "SYNC_NOT_CONFIGURED");
    const supplied =
      request.headers.get("x-valtrim-email-sync-secret")?.trim() ?? "";
    if (!supplied || supplied.length > 512) return reply(401, "UNAUTHORIZED");
    const digests = await Promise.all(
      [secret, supplied].map((value) =>
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
      ),
    );
    const a = new Uint8Array(digests[0]);
    const b = new Uint8Array(digests[1]);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference) return reply(401, "UNAUTHORIZED");
    if (!options.enabled) return reply(409, "SYNC_DISABLED");
    if (!options.credentialsConfigured) {
      return reply(503, "MICROSOFT_NOT_CONFIGURED");
    }
    let connectionId: string;
    let recovery: EmailSourceRecoveryInput | undefined;
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply(400, "INVALID_INPUT");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
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
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      if (
        !body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) =>
          !["connectionId", "sourceRecovery"].includes(key)
        ) ||
        typeof body.connectionId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.connectionId,
        )
      ) return reply(400, "INVALID_INPUT");
      if ("sourceRecovery" in body) {
        const value = body.sourceRecovery;
        if (
          !options.recover || !value || typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).length !== 2 ||
          typeof value.importId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            .test(value.importId) ||
          typeof value.expectedUpdatedAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
            .test(value.expectedUpdatedAt) ||
          !Number.isFinite(Date.parse(value.expectedUpdatedAt))
        ) return reply(400, "INVALID_INPUT");
        recovery = {
          importId: value.importId,
          expectedUpdatedAt: value.expectedUpdatedAt,
        };
      }
      connectionId = body.connectionId;
    } catch {
      return reply(400, "INVALID_INPUT");
    }
    try {
      const result = recovery
        ? await options.recover!(connectionId, recovery)
        : await options.run(connectionId);
      const status = result.status === "FAILED"
        ? 503
        : ["NEEDS_RECONCILIATION", "RECOVERY_REJECTED", "RECOVERY_CONFLICT"]
            .includes(result.status)
        ? 409
        : result.status === "UNCONFIRMED"
        ? 503
        : 200;
      return Response.json(result, {
        status,
        headers: result.retryAfterSeconds
          ? { "Retry-After": String(result.retryAfterSeconds) }
          : undefined,
      });
    } catch {
      return reply(503, "SYNC_EXECUTION_NOT_CONFIRMED");
    }
  };
}
