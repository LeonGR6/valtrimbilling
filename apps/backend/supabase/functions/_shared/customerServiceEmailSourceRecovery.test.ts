import { assert, assertEquals } from "@std/assert";
import {
  type EmailSourceRecoveryReceipt,
  recoverCustomerServiceEmailSource,
} from "./customerServiceEmailSourceRecovery.ts";
import { customerServiceEmailSourceRecoveryStorage } from "./customerServiceEmailSourceRecoveryStorage.ts";
import { createCustomerServiceEmailSyncHandler } from "./customerServiceEmailSync.ts";
import { MicrosoftGraphSyncError } from "./customerServiceMicrosoftGraph.ts";
import type { EmailConnectionState } from "./customerServiceEmailConnection.ts";

const tenantId = "10000000-0000-0000-0000-000000000001";
const mailboxId = "20000000-0000-0000-0000-000000000002";
const connectionId = "30000000-0000-0000-0000-000000000003";
const importId = "40000000-0000-0000-0000-000000000004";
const token = "50000000-0000-0000-0000-000000000005";
const input = { importId, expectedUpdatedAt: "2026-10-27T10:00:00.123456Z" };
const source = {
  body: { contentType: "text", content: "Owner: Test. Item: repair door." },
};
function fixture() {
  const calls: string[] = [];
  const connection = {
    id: connectionId,
    tenant_id: tenantId,
    mailbox_id: mailboxId,
    folder_id: "Folder",
    enabled: true,
    initialized_at: input.expectedUpdatedAt,
    revision: 5,
    sync_token: token,
    last_error_code: null,
    retry_not_before: null,
  } as EmailConnectionState;
  const receipt: EmailSourceRecoveryReceipt = {
    importId,
    tenantId,
    mailboxId,
    messageId: "M",
    sourceStatus: "REJECTED",
    status: "NEEDS_ATTENTION",
    requestId: null,
    errorCode: "ATTACHMENT_SIZE",
    source: {},
    manifest: null,
    sourceContractVersion: 1,
    sourceConnectionId: null,
  };
  const files = [{
    id: "F",
    file: new File(["%PDF-1.7"], "work.pdf", { type: "application/pdf" }),
  }];
  let claimAvailable = true;
  let prepareFailure: unknown;
  let graphFailure: unknown;
  let finishFailure: unknown;
  let storageFailure = false;
  const outcome = () => ({
    importId,
    sourceStatus: receipt.sourceStatus,
    status: receipt.status,
    requestId: receipt.requestId,
  });
  const ports = {
    connections: {
      read: () => Promise.resolve(connection),
      claim: () => {
        calls.push("claim");
        return Promise.resolve(claimAvailable ? connection : null);
      },
      finish: () => {
        calls.push("finish");
        if (finishFailure) throw finishFailure;
        return Promise.resolve(connection);
      },
      defer: (_row: unknown, code: string, delay: number) => {
        calls.push(`defer:${code}:${delay}`);
        return Promise.resolve(connection);
      },
    },
    graph: {
      tenantId,
      message: () => {
        calls.push("message");
        if (graphFailure) throw graphFailure;
        return Promise.resolve({ id: "M", ...source });
      },
      attachments: () => {
        calls.push("attachments");
        return Promise.resolve([]);
      },
      files: (_target: unknown, _id: string, metadata: unknown[]) => {
        calls.push("files");
        if (receipt.manifest) {
          assertEquals((metadata[0] as { id: string }).id, "F");
        }
        return Promise.resolve(files);
      },
    },
    recovery: {
      read: () => Promise.resolve(receipt),
      prepare: (
        _connection: EmailConnectionState,
        received: unknown,
        body: unknown,
        manifest: unknown,
      ) => {
        calls.push("prepare");
        assertEquals(received, input);
        assertEquals(body, source);
        if (prepareFailure) throw prepareFailure;
        receipt.sourceStatus = "UPLOADING";
        receipt.sourceContractVersion = 2;
        receipt.sourceConnectionId = connectionId;
        receipt.source = { ...source, attachments: [] };
        receipt.manifest = manifest as Record<string, unknown>[];
        return Promise.resolve(outcome());
      },
    },
    sources: {
      retain: () => {
        calls.push("retain");
        receipt.sourceStatus = storageFailure ? "UPLOADING" : "AVAILABLE";
        receipt.status = storageFailure ? "NEEDS_ATTENTION" : "PENDING";
        return Promise.resolve(outcome());
      },
      failPinned: () => {
        calls.push("failPinned");
        return Promise.resolve(outcome());
      },
    },
  };
  return {
    calls,
    receipt,
    connection,
    files,
    busy: () => {
      claimAvailable = false;
    },
    failPrepare: (error: unknown) => {
      prepareFailure = error;
    },
    failGraph: (error: unknown) => {
      graphFailure = error;
    },
    failFinish: (error: unknown) => {
      finishFailure = error;
    },
    failStorage: () => {
      storageFailure = true;
    },
    run: () =>
      recoverCustomerServiceEmailSource(
        {
          connectionId,
          input,
          ...ports,
          now: () => 0,
        } as unknown as Parameters<typeof recoverCustomerServiceEmailSource>[0],
      ),
  };
}

Deno.test("Source recovery validates complete files before fencing/pinning and retaining the same import, without a delta checkpoint or AI", async () => {
  const f = fixture();
  const result = await f.run();
  assertEquals(result.status, "SOURCE_RECOVERED");
  assertEquals(result.importIds, [importId]);
  assertEquals(f.calls, [
    "claim",
    "message",
    "attachments",
    "files",
    "prepare",
    "retain",
    "finish",
  ]);
  assertEquals(f.receipt.sourceStatus, "AVAILABLE");
  assertEquals(f.receipt.requestId, null);
});

Deno.test("Invalid recovered bytes never reopen the rejected receipt or retain a subset", async () => {
  const f = fixture();
  f.files[0].file = new File(["invalid signature"], "work.pdf", {
    type: "application/pdf",
  });
  const result = await f.run();
  assertEquals(result.status, "RECOVERY_REJECTED");
  assertEquals(result.errorCode, "ATTACHMENT_SIGNATURE");
  assertEquals(f.receipt.sourceStatus, "REJECTED");
  assert(!f.calls.includes("prepare") && !f.calls.includes("retain"));
});

Deno.test("A stale import version or lost lease cannot upload or mutate a pinned receipt", async () => {
  for (const code of ["40001", "55000", "42501"]) {
    const f = fixture();
    f.failPrepare({ code });
    assertEquals((await f.run()).status, "RECOVERY_CONFLICT");
    assertEquals(f.receipt.sourceStatus, "REJECTED");
    assert(!f.calls.includes("retain") && !f.calls.includes("failPinned"));
  }
});

Deno.test("Replaying an accepted or linked import never reads Graph or replaces human data", async () => {
  for (const linked of [false, true]) {
    const f = fixture();
    if (linked) f.receipt.requestId = 596;
    else f.receipt.sourceStatus = "AVAILABLE";
    assertEquals((await f.run()).replayed, 1);
    assertEquals(f.calls, ["claim", "finish"]);
  }
});

Deno.test("Different mailbox/tenant identities and unrelated rejection codes cannot use the correction", async () => {
  for (const variant of ["tenant", "mailbox", "format", "pending"]) {
    const f = fixture();
    if (variant === "tenant") f.receipt.tenantId = connectionId;
    if (variant === "mailbox") f.receipt.mailboxId = connectionId;
    if (variant === "format") f.receipt.errorCode = "ATTACHMENT_FORMAT";
    if (variant === "pending") f.receipt.sourceStatus = "PENDING";
    assertEquals((await f.run()).status, "RECOVERY_CONFLICT");
    assertEquals(f.calls, ["claim", "finish"]);
  }
});

Deno.test("Disabled, uninitialized, busy, expired-cursor and deferred connections do not recover sources", async () => {
  for (
    const variant of [
      "disabled",
      "uninitialized",
      "busy",
      "expired",
      "deferred",
    ]
  ) {
    const f = fixture();
    if (variant === "disabled") f.connection.enabled = false;
    if (variant === "uninitialized") f.connection.initialized_at = null;
    if (variant === "busy") f.busy();
    if (variant === "expired") f.connection.last_error_code = "CURSOR_EXPIRED";
    if (variant === "deferred") {
      f.connection.retry_not_before = "2026-10-27T10:00:00Z";
    }
    await f.run();
    assert(!f.calls.includes("message") && !f.calls.includes("prepare"));
  }
});

Deno.test("Graph throttling preserves the original rejection and server retry delay", async () => {
  const f = fixture();
  f.failGraph(new MicrosoftGraphSyncError("GRAPH_THROTTLED", 120));
  const result = await f.run();
  assertEquals(result.status, "FAILED");
  assertEquals(result.retryAfterSeconds, 120);
  assertEquals(f.receipt.sourceStatus, "REJECTED");
  assertEquals(f.calls, ["claim", "message", "defer:GRAPH_THROTTLED:120"]);
});

Deno.test("An interrupted recovery resumes the immutable body and manifest without re-reading newer message metadata", async () => {
  const f = fixture();
  await f.run();
  f.receipt.sourceStatus = "UPLOADING";
  f.calls.length = 0;
  assertEquals((await f.run()).status, "SOURCE_RECOVERED");
  assertEquals(f.calls, ["claim", "files", "prepare", "retain", "finish"]);
});

Deno.test("Failed storage does not report a recovered source and can be resumed", async () => {
  const f = fixture();
  f.failStorage();
  assertEquals((await f.run()).status, "RECOVERY_REJECTED");
  assertEquals(f.receipt.sourceStatus, "UPLOADING");
  assertEquals(f.receipt.status, "NEEDS_ATTENTION");
});

Deno.test("Historical pending images are preserved for manual recovery without calling Graph or storage", async () => {
  const f = fixture();
  f.receipt.sourceStatus = "UPLOADING";
  f.receipt.manifest = [{ attachmentId: "old-image", mimeType: "image/png", objectPath: "historical/image" }];
  const original = structuredClone(f.receipt);
  const result = await f.run();
  assertEquals(result.status, "RECOVERY_REJECTED");
  assertEquals(result.errorCode, "HISTORICAL_IMAGES_REQUIRE_MANUAL_RECOVERY");
  assertEquals(f.calls, ["claim", "finish"]);
  assertEquals(f.receipt, original);
});

Deno.test("Lost prepare/finish responses never pretend recovery completed", async () => {
  const pin = fixture();
  pin.failPrepare(new Error("lost prepare response"));
  assertEquals((await pin.run()).status, "UNCONFIRMED");
  assert(!pin.calls.includes("retain") && !pin.calls.includes("failPinned"));
  const finish = fixture();
  finish.failFinish(new Error("lost release response"));
  assertEquals((await finish.run()).status, "UNCONFIRMED");
  assertEquals(finish.receipt.sourceStatus, "AVAILABLE");
});

Deno.test("Recovery HTTP requires the sync secret and exactly an existing import identity/version, without Graph configuration inputs", async () => {
  const secret = "fake-server-secret-at-least-32-characters";
  const f = fixture();
  const handler = createCustomerServiceEmailSyncHandler({
    secret,
    enabled: true,
    credentialsConfigured: true,
    run: () => {
      throw new Error("Do not run delta during recovery");
    },
    recover: (id, received) => {
      assertEquals(id, connectionId);
      assertEquals(received, input);
      return f.run();
    },
  });
  const request = (body: unknown, key = secret) =>
    new Request("https://test.invalid/sync", {
      method: "POST",
      headers: { "x-valtrim-email-sync-secret": key },
      body: JSON.stringify(body),
    });
  assertEquals(
    (await handler(request({ connectionId, sourceRecovery: input }, "wrong")))
      .status,
    401,
  );
  for (
    const sourceRecovery of [
      null,
      {},
      { ...input, clientSecret: "forbidden" },
      { ...input, importId: "bad" },
      { ...input, expectedUpdatedAt: "bad" },
    ]
  ) {
    assertEquals(
      (await handler(request({ connectionId, sourceRecovery }))).status,
      400,
    );
  }
  assertEquals(f.calls, []);
  assertEquals(
    (await handler(request({ connectionId, sourceRecovery: input }))).status,
    200,
  );
});

Deno.test("Recovery storage binds lease/revision and the exact import version to the dedicated server RPC", async () => {
  const calls: Record<string, unknown>[] = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: { importId, sourceStatus: "UPLOADING", requestId: null },
        error: null,
      });
    },
  } as unknown as Parameters<
    typeof customerServiceEmailSourceRecoveryStorage
  >[0];
  await customerServiceEmailSourceRecoveryStorage(admin).prepare(
    fixture().connection,
    input,
    source,
    [],
    2,
  );
  assertEquals(calls, [{
    name: "prepare_customer_service_graph_source_recovery_v2",
    args: {
      p_connection_id: connectionId,
      p_sync_token: token,
      p_expected_revision: 5,
      p_import_id: importId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_source_payload: source,
      p_attachments: [],
    },
  }]);
  await customerServiceEmailSourceRecoveryStorage(admin).prepare(fixture().connection, input, source, [], 1);
  assertEquals(calls[1].name, "prepare_customer_service_graph_source_recovery");
});
