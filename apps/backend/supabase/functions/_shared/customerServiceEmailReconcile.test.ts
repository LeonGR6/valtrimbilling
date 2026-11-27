import { assertEquals } from "@std/assert";
import {
  createCustomerServiceEmailReconcileHandler,
  reconcileCustomerServiceEmailFolder,
} from "./customerServiceEmailReconcile.ts";
import { MicrosoftGraphSyncError } from "./customerServiceMicrosoftGraph.ts";
import type { createCustomerServiceEmailConnectionRepository } from "./customerServiceEmailConnection.ts";
import type { serviceClient } from "./supabase.ts";

const connectionId = "10000000-0000-0000-0000-000000000001";
function fixture(
  options: {
    claim?: unknown;
    graphError?: Error;
    nextUrl?: string | null;
    finishFails?: boolean;
  } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const reads: unknown[] = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({
        error: name.startsWith("finish_") && options.finishFails
          ? new Error("private SQL failure")
          : null,
        data: name.startsWith("claim_")
          ? options.claim === undefined
            ? { token: "fenced-token", nextUrl: options.nextUrl ?? null }
            : options.claim
          : null,
      });
    },
  } as unknown as Pick<ReturnType<typeof serviceClient>, "rpc">;
  const connections = {
    read: () =>
      Promise.resolve({
        tenant_id: "tenant",
        mailbox_id: "mailbox",
        folder_id: "folder",
      }),
  } as unknown as Pick<
    ReturnType<typeof createCustomerServiceEmailConnectionRepository>,
    "read"
  >;
  return {
    calls,
    reads,
    options: {
      connectionId,
      admin,
      connections,
      graph: {
        folderMessageIds: (target: unknown, nextUrl: unknown) => {
          reads.push({ target, nextUrl });
          if (options.graphError) return Promise.reject(options.graphError);
          return Promise.resolve({
            messageIds: ["M1", "M2"],
            webLinks: {},
            messageMetadata: [],
            nextUrl: options.nextUrl ?? null,
          });
        },
      },
    },
  };
}
Deno.test("Folder inventory saves only IDs independently of import and delta", async () => {
  const f = fixture();
  assertEquals(await reconcileCustomerServiceEmailFolder(f.options), {
    status: "SCAN_COMPLETE",
    checked: 2,
  });
  assertEquals(f.calls.map((c) => c.name), [
    "claim_customer_service_email_folder_scan",
    "finish_customer_service_email_folder_scan_metadata",
  ]);
  assertEquals(f.calls[1].args, {
    p_connection_id: connectionId,
    p_token: "fenced-token",
    p_message_ids: ["M1", "M2"],
    p_next_url: null,
    p_web_links: {},
    p_message_metadata: [],
  });
});
Deno.test("A paused, busy or not-due scan performs no Graph read", async () => {
  const f = fixture({ claim: null });
  assertEquals(await reconcileCustomerServiceEmailFolder(f.options), {
    status: "IDLE",
  });
  assertEquals(f.reads.length, 0);
});
Deno.test("Metadata continuation is retained for the next invocation", async () => {
  const nextUrl =
    "https://graph.microsoft.com/v1.0/users/mailbox/mailFolders/folder/messages?$skip=100";
  const f = fixture({ nextUrl });
  assertEquals(
    (await reconcileCustomerServiceEmailFolder(f.options)).status,
    "SCAN_PAGE",
  );
  assertEquals(f.calls[1].args.p_next_url, nextUrl);
  assertEquals((f.reads[0] as { nextUrl: string }).nextUrl, nextUrl);
});
Deno.test("Graph throttling is visible and preserves retry-after without provider diagnostics", async () => {
  const f = fixture({
    graphError: new MicrosoftGraphSyncError("GRAPH_THROTTLED", 1200),
  });
  assertEquals(await reconcileCustomerServiceEmailFolder(f.options), {
    status: "FAILED",
    errorCode: "GRAPH_THROTTLED",
  });
  assertEquals(f.calls[1].args.p_retry_after_seconds, 1200);
  assertEquals(f.calls[1].args.p_message_ids, []);
});
Deno.test("Unknown failures produce only a sanitized code", async () => {
  const f = fixture({
    graphError: new Error("raw credential/body diagnostic"),
  });
  assertEquals(await reconcileCustomerServiceEmailFolder(f.options), {
    status: "FAILED",
    errorCode: "SYNC_ERROR",
  });
});
Deno.test("Inventory HTTP handler rejects unauthorized and extra inputs", async () => {
  let runs = 0;
  const secret = "s".repeat(40);
  const handler = createCustomerServiceEmailReconcileHandler({
    secret,
    enabled: true,
    credentialsConfigured: true,
    run: () => {
      runs++;
      return Promise.resolve({ status: "SCAN_COMPLETE" });
    },
  });
  const request = (body: unknown, authenticated = true) =>
    new Request("https://example.test/inventory", {
      method: "POST",
      headers: authenticated ? { "x-valtrim-email-sync-secret": secret } : {},
      body: JSON.stringify(body),
    });
  assertEquals((await handler(request({ connectionId }, false))).status, 401);
  assertEquals(
    (await handler(request({ connectionId, sourceRecovery: {} }))).status,
    400,
  );
  assertEquals((await handler(request({ connectionId }))).status, 200);
  assertEquals(runs, 1);
});
