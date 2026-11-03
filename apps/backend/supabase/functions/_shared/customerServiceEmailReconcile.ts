import type { serviceClient } from "./supabase.ts";
import type { createCustomerServiceEmailConnectionRepository } from "./customerServiceEmailConnection.ts";
import {
  type createCustomerServiceMicrosoftGraph,
  MicrosoftGraphSyncError,
} from "./customerServiceMicrosoftGraph.ts";

// One bounded inventory page per invocation. Retain IDs/links and safe headers in a
// separate scan, never bodies, attachment bytes, imports or the delta boundary.
export async function reconcileCustomerServiceEmailFolder(options: {
  connectionId: string;
  connections: Pick<
    ReturnType<typeof createCustomerServiceEmailConnectionRepository>,
    "read"
  >;
  graph: Pick<
    ReturnType<typeof createCustomerServiceMicrosoftGraph>,
    "folderMessageIds"
  >;
  admin: Pick<ReturnType<typeof serviceClient>, "rpc">;
}) {
  const { admin, connectionId } = options;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error("SCAN_DATABASE_ERROR");
    return data;
  };
  const claim = await rpc("claim_customer_service_email_folder_scan", {
    p_connection_id: connectionId,
  });
  if (!claim) return { status: "IDLE" };
  const identity = { p_connection_id: connectionId, p_token: claim.token };
  try {
    const c = await options.connections.read(connectionId);
    const page = await options.graph.folderMessageIds({
      tenantId: c.tenant_id,
      mailboxId: c.mailbox_id,
      folderId: c.folder_id,
    }, claim.nextUrl);
    await rpc("finish_customer_service_email_folder_scan_metadata", {
      ...identity,
      p_message_ids: page.messageIds,
      p_next_url: page.nextUrl,
      p_web_links: page.webLinks,
      p_message_metadata: page.messageMetadata,
    });
    return {
      status: page.nextUrl ? "SCAN_PAGE" : "SCAN_COMPLETE",
      checked: page.messageIds.length,
    };
  } catch (error) {
    const code = error instanceof MicrosoftGraphSyncError &&
        error.code !== "CURSOR_EXPIRED"
      ? error.code
      : "SYNC_ERROR";
    await rpc("finish_customer_service_email_folder_scan", {
      ...identity,
      p_message_ids: [],
      p_next_url: null,
      p_error_code: code,
      p_retry_after_seconds: error instanceof MicrosoftGraphSyncError
        ? error.retryAfterSeconds
        : 60,
    });
    return { status: "FAILED", errorCode: code };
  }
}

export function createCustomerServiceEmailReconcileHandler(options: {
  secret: string;
  enabled: boolean;
  credentialsConfigured: boolean;
  run: (
    connectionId: string,
  ) => Promise<{ status: string; checked?: number; errorCode?: string }>;
}) {
  return async (request: Request) => {
    const reply = (status: number, error: string) =>
      Response.json({ error }, { status });
    if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
    const secret = options.secret.trim();
    if (secret.length < 32) return reply(503, "SYNC_NOT_CONFIGURED");
    const supplied =
      request.headers.get("x-valtrim-email-sync-secret")?.trim() ?? "";
    if (!supplied || supplied.length > 512) return reply(401, "UNAUTHORIZED");
    const digests = await Promise.all(
      [secret, supplied].map((s) =>
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
      ),
    );
    const [a, b] = digests.map((d) => new Uint8Array(d));
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference) return reply(401, "UNAUTHORIZED");
    if (!options.enabled) return reply(409, "SYNC_DISABLED");
    if (!options.credentialsConfigured) {
      return reply(503, "MICROSOFT_NOT_CONFIGURED");
    }
    let connectionId: string;
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
        Object.keys(body).length !== 1 ||
        typeof body.connectionId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.connectionId,
        )
      ) {
        return reply(400, "INVALID_INPUT");
      }
      connectionId = body.connectionId;
    } catch {
      return reply(400, "INVALID_INPUT");
    }
    try {
      const result = await options.run(connectionId);
      return Response.json(result, {
        status: result.status === "FAILED" ? 503 : 200,
      });
    } catch {
      return reply(503, "SCAN_EXECUTION_NOT_CONFIRMED");
    }
  };
}
