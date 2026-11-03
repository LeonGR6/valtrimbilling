import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type EmailConnectionState,
  type EmailSyncCursor,
} from "./customerServiceEmailConnection.ts";
import {
  EmailAttachmentValidationError,
  type EmailImportAttachment,
  validateEmailImportAttachments,
} from "./customerServiceEmailAttachments.ts";
import {
  createCustomerServiceEmailSyncHandler,
  type EmailSyncReceipt,
  type EmailSyncResult,
  syncCustomerServiceEmailPage,
} from "./customerServiceEmailSync.ts";
import {
  createCustomerServiceMicrosoftGraph,
  type GraphDeltaPage,
  type GraphMessage,
  MicrosoftGraphSyncError,
} from "./customerServiceMicrosoftGraph.ts";

const tenantId = "10000000-0000-0000-0000-000000000001";
const mailboxId = "20000000-0000-0000-0000-000000000002";
const connectionId = "30000000-0000-0000-0000-000000000003";
const syncToken = "40000000-0000-0000-0000-000000000004";
const idFor = (index: number) =>
  `50000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
const base =
  `https://graph.microsoft.com/v1.0/users/${mailboxId}/mailFolders/Folder/messages/delta`;
const next: EmailSyncCursor = {
  kind: "NEXT",
  url: `${base}?$skiptoken=verbatim%2Bvalue`,
};
const delta: EmailSyncCursor = {
  kind: "DELTA",
  url: `${base}?$deltatoken=verbatim%2Bvalue`,
};
const message = (id: string): GraphMessage => ({
  id,
  subject: "Owner request",
  webLink: "https://outlook.office.com/mail/original",
  parentFolderId: "Folder",
  conversationId: "same-conversation",
  body: {
    contentType: "text",
    content: "Owner: Test Homeowner\nItem: repair door",
  },
});
function state(
  overrides: Partial<EmailConnectionState> = {},
): EmailConnectionState {
  return {
    id: connectionId,
    tenant_id: tenantId,
    mailbox_id: mailboxId,
    folder_id: "Folder",
    enabled: true,
    initial_sync_mode: "IMPORT_EXISTING",
    initialized_at: null,
    cursor_kind: null,
    cursor_url: null,
    revision: 1,
    sync_token: null,
    sync_lease_expires_at: null,
    attempt_count: 0,
    last_attempt_at: null,
    last_finished_at: null,
    last_success_at: null,
    last_error_code: null,
    last_error_message: null,
    last_error_at: null,
    retry_not_before: null,
    created_at: "2026-10-27T12:00:00Z",
    updated_at: "2026-10-27T12:00:00Z",
    ...overrides,
  };
}
function fixture(overrides: Partial<EmailConnectionState> = {}) {
  let row = state(overrides);
  const events: string[] = [];
  const receipts = new Map<string, EmailSyncReceipt>();
  const baselineIds = new Set<string>();
  const resolvedIds = new Set<string>();
  const pages: GraphDeltaPage[] = [];
  const passedImports: string[][] = [];
  const seenCursors: (EmailSyncCursor | null)[] = [];
  const retainedSources: Record<string, unknown>[] = [];
  let messageFailure: ((id: string) => void) | undefined;
  let checkpointFailure: unknown;
  let finishFailure: unknown;
  let deferFailure: unknown;
  let files: EmailImportAttachment[] = [];
  const ports = {
    connections: {
      read: () => Promise.resolve({ ...row }),
      claim: () => {
        events.push("claim");
        if (row.sync_token) return Promise.resolve(null);
        row = {
          ...row,
          sync_token: syncToken,
          sync_lease_expires_at: "2026-10-27T12:03:00Z",
          attempt_count: row.attempt_count + 1,
          revision: row.revision + 1,
        };
        return Promise.resolve({ ...row });
      },
      checkpoint: (
        _claimed: EmailConnectionState,
        cursor: EmailSyncCursor,
        ids: string[],
        baseline: string[] = [],
        removed: string[] = [],
      ) => {
        events.push("checkpoint");
        passedImports.push(ids);
        removed.forEach((id) => baselineIds.delete(id));
        baseline.forEach((id) => baselineIds.add(id));
        for (const id of ids) {
          assert(
            [...receipts.values()].some((receipt) =>
              receipt.importId === id &&
              (["AVAILABLE", "REJECTED", "LEGACY"].includes(
                receipt.sourceStatus,
              ) || receipt.status === "NEEDS_ATTENTION" ||
                receipt.requestId !== null)
            ),
          );
        }
        row = {
          ...row,
          cursor_kind: cursor.kind,
          cursor_url: cursor.url,
          revision: row.revision + 1,
          ...(cursor.kind === "DELTA"
            ? {
              initialized_at: "2026-10-27T12:00:01Z",
              last_success_at: "2026-10-27T12:00:01Z",
              sync_token: null,
            }
            : {}),
        };
        if (checkpointFailure) throw checkpointFailure;
        return Promise.resolve({ ...row });
      },
      baselineMatches: (_claimed: EmailConnectionState, ids: string[]) =>
        Promise.resolve(ids.filter((id) => baselineIds.has(id))),
      resolvedMatches: (_claimed: EmailConnectionState, ids: string[]) =>
        Promise.resolve(ids.filter((id) => resolvedIds.has(id))),
      finish: () => {
        events.push("finish");
        row = { ...row, sync_token: null };
        if (finishFailure) throw finishFailure;
        return Promise.resolve({ ...row });
      },
      defer: (
        _claimed: EmailConnectionState,
        code: EmailConnectionState["last_error_code"],
        delay: number,
      ) => {
        events.push(`defer:${code}:${delay}`);
        if (deferFailure) throw deferFailure;
        row = {
          ...row,
          sync_token: null,
          last_error_code: code,
          retry_not_before: delay ? new Date(delay * 1000).toISOString() : null,
        };
        return Promise.resolve({ ...row });
      },
    },
    graph: {
      tenantId,
      page: (_target: unknown, cursor: EmailSyncCursor | null) => {
        events.push("page");
        seenCursors.push(cursor);
        if (!pages.length) throw new Error("Unexpected page");
        return Promise.resolve(pages.shift()!);
      },
      message: (_target: unknown, id: string) => {
        events.push(`message:${id}`);
        messageFailure?.(id);
        return Promise.resolve(message(id));
      },
      attachments: () => {
        events.push("attachments");
        return Promise.resolve([]);
      },
      files: (_target: unknown, id: string, metadata: unknown[]) => {
        events.push(`files:${id}:${metadata.length}`);
        return Promise.resolve(files);
      },
    },
    sources: {
      register: (_target: unknown, value: GraphMessage) => {
        events.push(`register:${value.id}`);
        if (!receipts.has(value.id)) {
          receipts.set(value.id, {
            importId: idFor(receipts.size + 1),
            sourceStatus: "PENDING",
            status: "PENDING",
            requestId: null,
            source: { webLink: value.webLink },
            manifest: null,
            sourceContractVersion: 1,
            sourceConnectionId: null,
          });
        }
        return Promise.resolve(receipts.get(value.id)!);
      },
      retain: async (
        importId: string,
        source: Record<string, unknown>,
        attachments: EmailImportAttachment[],
      ) => {
        await validateEmailImportAttachments(attachments);
        events.push(`retain:${importId}`);
        retainedSources.push(source);
        const receipt = [...receipts.values()].find((receipt) =>
          receipt.importId === importId
        )!;
        receipt.sourceStatus = "AVAILABLE";
        receipt.source = source;
        return {
          importId,
          sourceStatus: "AVAILABLE",
          status: "PENDING",
          requestId: null,
        };
      },
      reject: (importId: string, code: string) => {
        events.push(`reject:${code}`);
        const receipt = [...receipts.values()].find((receipt) =>
          receipt.importId === importId
        )!;
        receipt.sourceStatus = "REJECTED";
        receipt.status = "NEEDS_ATTENTION";
        return Promise.resolve({
          importId,
          sourceStatus: "REJECTED",
          status: "NEEDS_ATTENTION",
          requestId: null,
        });
      },
      failPinned: (importId: string, reason?: string) => {
        events.push(`failPinned:${reason ?? "MISMATCH"}`);
        const receipt = [...receipts.values()].find((receipt) =>
          receipt.importId === importId
        )!;
        receipt.status = "NEEDS_ATTENTION";
        return Promise.resolve({
          importId,
          sourceStatus: receipt.sourceStatus,
          status: "NEEDS_ATTENTION",
          requestId: null,
        });
      },
    },
  };
  return {
    events,
    resolvedIds,
    receipts,
    pages,
    passedImports,
    seenCursors,
    retainedSources,
    ports,
    read: () => row,
    failMessage: (fn: typeof messageFailure) => {
      messageFailure = fn;
    },
    failCheckpoint: (error: unknown) => {
      checkpointFailure = error;
    },
    failFinish: (error: unknown) => {
      finishFailure = error;
    },
    failDefer: (error: unknown) => {
      deferFailure = error;
    },
    setFiles: (value: EmailImportAttachment[]) => {
      files = value;
    },
    run: () =>
      syncCustomerServiceEmailPage(
        { connectionId, ...ports, now: () => 0 } as unknown as Parameters<
          typeof syncCustomerServiceEmailPage
        >[0],
      ),
  };
}

Deno.test("human-confirmed messages are skipped even after removal/reentry, while a different message still imports", async () => {
  const f = fixture({ initialized_at: "2026-10-27T12:00:01Z" });
  f.resolvedIds.add("Related");
  f.pages.push({
    messages: [
      { id: "Related", "@removed": { reason: "deleted" } },
      message("Related"),
      message("Different"),
    ],
    cursor: delta,
  });
  const result = await f.run();
  assertEquals(result.status, "ROUND_COMPLETE");
  assertEquals(result.resolvedSkipped, 1);
  assertEquals(f.receipts.has("Related"), false);
  assertEquals(f.receipts.has("Different"), true);
  assertEquals(f.events.includes("message:Related"), false);
  assertEquals(f.passedImports, [[idFor(1)]]);
});

Deno.test("a deleted resolution target no longer excludes that message from the next delta", async () => {
  const f = fixture({ initialized_at: "2026-10-27T12:00:01Z" });
  f.resolvedIds.add("Related");
  f.pages.push({ messages: [message("Related")], cursor: delta });
  assertEquals((await f.run()).resolvedSkipped, 1);
  f.resolvedIds.delete("Related");
  f.pages.push({ messages: [message("Related")], cursor: delta });
  assertEquals((await f.run()).retained, 1);
  assertEquals(f.receipts.size, 1);
});

Deno.test("a failed resolution check retains the cursor without registering or downloading any message", async () => {
  const f = fixture({ initialized_at: "2026-10-27T12:00:01Z" });
  f.ports.connections.resolvedMatches = () =>
    Promise.reject(new Error("database unavailable"));
  f.pages.push({ messages: [message("Related")], cursor: delta });
  assertEquals((await f.run()).status, "FAILED");
  assertEquals(f.receipts.size, 0);
  assertEquals(f.passedImports, []);
  assertEquals(f.events.includes("message:Related"), false);
  assertEquals(f.read().cursor_url, null);
});

Deno.test("BASELINE_ONLY spans initial pages without registering, downloading or analyzing historical messages", async () => {
  const f = fixture({ initial_sync_mode: "BASELINE_ONLY" });
  f.pages.push(
    { messages: [message("old-1"), message("old-2")], cursor: next },
    { messages: [message("old-3")], cursor: delta },
  );
  assertEquals((await f.run()).baselineSkipped, 2);
  assertEquals(f.read().initialized_at, null);
  assertEquals((await f.run()).status, "ROUND_COMPLETE");
  assertEquals(f.receipts.size, 0);
  assertEquals(f.passedImports, [[], []]);
  assertEquals(f.seenCursors, [null, next]);
  assert(
    !f.events.some((event) =>
      /register|message:|attachments|retain:/.test(event)
    ),
  );
  f.pages.push({ messages: [message("new-after-baseline")], cursor: delta });
  assertEquals((await f.run()).retained, 1);
  assertEquals(f.receipts.size, 1);
});

Deno.test("Graph delivery retains the entire body, then checkpoints every non-removed message without approving a request", async () => {
  const f = fixture();
  f.pages.push({
    messages: [
      message("M1"),
      { id: "gone", "@removed": { reason: "deleted" } },
      message("M2"),
    ],
    cursor: delta,
  });
  const result = await f.run();
  assertEquals(result.status, "ROUND_COMPLETE");
  assertEquals(result.retained, 2);
  assertEquals(result.removed, 1);
  assertEquals(f.passedImports, [[idFor(1), idFor(2)]]);
  assertEquals(f.retainedSources[0].body, message("M1").body);
  assert(
    [...f.receipts.values()].every((receipt) =>
      receipt.sourceStatus === "AVAILABLE" && receipt.status === "PENDING" &&
      receipt.requestId === null
    ),
  );
  assert(
    f.events.indexOf(`retain:${idFor(2)}`) < f.events.indexOf("checkpoint"),
  );
});

Deno.test("Read/unread changes of baseline messages stay excluded; a later observed exit and reentry is a new folder intake", async () => {
  const f = fixture({ initial_sync_mode: "BASELINE_ONLY" });
  f.pages.push({ messages: [message("historical")], cursor: delta });
  await f.run();
  f.pages.push({
    messages: [{ id: "historical", isRead: true }],
    cursor: delta,
  });
  assertEquals((await f.run()).baselineSkipped, 1);
  assertEquals(f.receipts.size, 0);
  f.pages.push({
    messages: [{ id: "historical", "@removed": { reason: "deleted" } }],
    cursor: delta,
  });
  await f.run();
  f.pages.push({ messages: [message("historical")], cursor: delta });
  assertEquals((await f.run()).retained, 1);
  assertEquals(f.receipts.size, 1);
});

Deno.test("Replayed messages reuse receipts and retained originals even if Outlook's content changed", async () => {
  const f = fixture();
  f.pages.push({ messages: [message("M")], cursor: delta });
  await f.run();
  f.events.length = 0;
  f.pages.push({
    messages: [{ ...message("M"), subject: "Changed externally" }],
    cursor: delta,
  });
  assertEquals((await f.run()).replayed, 1);
  assertEquals(f.receipts.size, 1);
  assertEquals(f.retainedSources.length, 1);
  assert(
    !f.events.some((event) =>
      event.startsWith("message:") || event.startsWith("retain:")
    ),
  );
});

Deno.test("Duplicate page IDs are delivered once, case-sensitive IDs and separate messages in one conversation remain distinct", async () => {
  const f = fixture();
  f.pages.push({
    messages: [
      message("M"),
      message("M"),
      message("m"),
      message("second-in-conversation"),
    ],
    cursor: delta,
  });
  assertEquals((await f.run()).retained, 3);
  assertEquals(f.receipts.size, 3);
});

Deno.test("A partial page failure never advances, and replay resumes without re-uploading the first message", async () => {
  const f = fixture();
  const value = { messages: [message("M1"), message("M2")], cursor: delta };
  f.pages.push(value);
  f.failMessage((id) => {
    if (id === "M2") throw new MicrosoftGraphSyncError("GRAPH_UNAVAILABLE", 60);
  });
  assertEquals((await f.run()).status, "FAILED");
  assertEquals(f.read().cursor_url, null);
  assertEquals(f.passedImports.length, 0);
  assertEquals(f.retainedSources.length, 1);
  // Simulate the provider backoff becoming due; the durable SQL test exercises
  // the real clock gate. The exact same page is then redelivered.
  f.read().retry_not_before = null;
  f.failMessage(undefined);
  f.pages.push(value);
  const retried = await f.run();
  assertEquals(retried.replayed, 1);
  assertEquals(retried.retained, 1);
  assertEquals(f.retainedSources.length, 2);
  assertEquals(f.passedImports, [[idFor(1), idFor(2)]]);
});

Deno.test("A failed attachment stores only a recoverable technical problem and still accounts for the page", async () => {
  const f = fixture();
  f.pages.push({ messages: [message("M")], cursor: delta });
  f.ports.graph.attachments = () => {
    throw new EmailAttachmentValidationError(
      "ATTACHMENT_COUNT",
      "El correo supera 10 archivos.",
    );
  };
  const result = await f.run();
  assertEquals(result.status, "ROUND_COMPLETE");
  assertEquals(f.receipts.get("M")!.status, "NEEDS_ATTENTION");
  assertEquals(f.retainedSources.length, 0);
  assertEquals(f.receipts.get("M")!.source, { webLink: message("M").webLink });
  assert(!f.events.some((event) => event.startsWith("files:")));
});

Deno.test("Unreadable/missing message bodies use manual recovery without invented request fields", async () => {
  const f = fixture();
  f.pages.push({ messages: [message("M")], cursor: delta });
  f.ports.graph.message = () => Promise.resolve({ id: "M" } as GraphMessage);
  await f.run();
  assert(f.events.includes("reject:SOURCE_METADATA"));
  assertEquals(f.receipts.get("M")!.requestId, null);
});

Deno.test("A valid image or PDF is delivered with the source, a bad signature uploads nothing", async () => {
  const valid = fixture();
  valid.pages.push({ messages: [message("M")], cursor: delta });
  valid.setFiles([{
    id: "PDF",
    file: new File(["%PDF-1.7"], "source.pdf", { type: "application/pdf" }),
  }]);
  assertEquals((await valid.run()).status, "ROUND_COMPLETE");
  const bad = fixture();
  bad.pages.push({ messages: [message("M")], cursor: delta });
  bad.setFiles([{
    id: "PDF",
    file: new File(["not a pdf"], "source.pdf", { type: "application/pdf" }),
  }]);
  await bad.run();
  assert(bad.events.includes("reject:ATTACHMENT_SIGNATURE"));
  assertEquals(bad.retainedSources.length, 0);
});

Deno.test("An interrupted pinned snapshot resumes its own body and manifest without re-reading current message data", async () => {
  const f = fixture();
  f.receipts.set("M", {
    importId: idFor(1),
    sourceStatus: "UPLOADING",
    status: "PENDING",
    requestId: null,
    source: {
      body: { contentType: "text", content: "Original pinned body" },
      attachments: [],
    },
    manifest: [],
    sourceContractVersion: 1,
    sourceConnectionId: null,
  });
  f.pages.push({ messages: [message("M")], cursor: delta });
  await f.run();
  assertEquals(f.retainedSources[0], {
    body: { contentType: "text", content: "Original pinned body" },
  });
  assert(!f.events.includes("message:M"));
  assert(!f.events.includes("attachments"));
});

Deno.test("New sources explicitly use V2 and carry the claimed connection token/revision", async () => {
  const f = fixture();
  const retain = f.ports.sources.retain;
  f.ports.sources.retain = (
    id,
    source,
    files,
    connection?: EmailConnectionState,
    version?: number,
  ) => {
    assertEquals(version, 2);
    assertEquals(connection?.id, connectionId);
    assertEquals(connection?.sync_token, syncToken);
    assertEquals(connection?.revision, f.read().revision);
    return retain(id, source, files);
  };
  f.pages.push({ messages: [message("V2")], cursor: delta });
  assertEquals((await f.run()).retained, 1);
});

Deno.test("V2 pending images resume the pinned snapshot from the same Graph connection", async () => {
  const f = fixture();
  const image = {
    id: "I",
    file: new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "photo.png",
      { type: "image/png" },
    ),
    isInline: true,
  };
  const manifest = await validateEmailImportAttachments([image]);
  f.setFiles([image]);
  f.receipts.set("M", {
    importId: idFor(1),
    sourceStatus: "UPLOADING",
    status: "PENDING",
    requestId: null,
    source: { bodyText: "Pinned original", attachments: [] },
    manifest: manifest.map((file) => ({ ...file, retention: "GRAPH_ONLY" })),
    sourceContractVersion: 2,
    sourceConnectionId: connectionId,
  });
  f.pages.push({ messages: [message("M")], cursor: delta });
  assertEquals((await f.run()).retained, 1);
  assertEquals(f.retainedSources, [{ bodyText: "Pinned original" }]);
  assert(!f.events.includes("message:M") && !f.events.includes("attachments"));
});

Deno.test("Historical pending images and foreign V2 origins become visible problems without file downloads or uploads", async () => {
  for (const version of [1, 2] as const) {
    const f = fixture();
    const snapshot = {
      importId: idFor(1),
      sourceStatus: "UPLOADING",
      status: "PENDING",
      requestId: null,
      source: { bodyText: "Keep historical evidence" },
      manifest: [{
        attachmentId: "I",
        mimeType: "image/png",
        objectPath: "old/path",
      }],
      sourceContractVersion: version,
      sourceConnectionId: version === 1 ? null : idFor(8),
    };
    f.receipts.set("M", snapshot);
    f.pages.push({ messages: [message("M")], cursor: delta });
    assertEquals((await f.run()).status, "ROUND_COMPLETE");
    assertEquals(snapshot.status, "NEEDS_ATTENTION");
    assertEquals(snapshot.source.bodyText, "Keep historical evidence");
    assertEquals(f.retainedSources.length, 0);
    assert(
      !f.events.some((event) => /^(files:|message:|attachments)/.test(event)),
    );
    assert(
      f.events.includes(
        `failPinned:${version === 1 ? "LEGACY_IMAGES" : "MISMATCH"}`,
      ),
    );
  }
});

Deno.test("Already linked requests and durable source problems are never reprocessed or overwritten", async () => {
  const f = fixture();
  for (
    const [index, status, sourceStatus, requestId] of [
      [1, "PROCESSED", "AVAILABLE", 596],
      [2, "NEEDS_ATTENTION", "FAILED", null],
      [3, "NEEDS_ATTENTION", "REJECTED", null],
    ] as const
  ) {
    f.receipts.set(`M${index}`, {
      importId: idFor(index),
      status,
      sourceStatus,
      requestId,
      source: {},
      manifest: null,
      sourceContractVersion: 1,
      sourceConnectionId: null,
    });
  }
  f.pages.push({
    messages: [message("M1"), message("M2"), message("M3")],
    cursor: delta,
  });
  assertEquals((await f.run()).replayed, 3);
  assertEquals(f.retainedSources.length, 0);
  assertEquals(f.receipts.get("M1")!.requestId, 596);
});

Deno.test("Disabled, throttled or expired connections do not call Graph or acquire a lease", async () => {
  for (
    const overrides of [{ enabled: false }, {
      retry_not_before: "2026-10-28T00:00:00Z",
    }, { last_error_code: "CURSOR_EXPIRED" }] as Partial<EmailConnectionState>[]
  ) {
    const f = fixture(overrides);
    await f.run();
    assertEquals(f.events, []);
  }
  const otherTenant = fixture({ tenant_id: mailboxId });
  await assertRejects(
    () => otherTenant.run(),
    MicrosoftGraphSyncError,
    "AUTH_FAILED",
  );
  assertEquals(otherTenant.events, []);
});

Deno.test("Expired delta tokens stop for controlled reconciliation and never replace the saved cursor", async () => {
  const f = fixture({
    cursor_kind: "DELTA",
    cursor_url: delta.url,
    initialized_at: "2026-10-26T00:00:00Z",
  });
  f.ports.graph.page = () => {
    throw new MicrosoftGraphSyncError("CURSOR_EXPIRED");
  };
  const result = await f.run();
  assertEquals(result.status, "NEEDS_RECONCILIATION");
  assertEquals(f.read().cursor_url, delta.url);
  assertEquals(f.read().initialized_at, "2026-10-26T00:00:00Z");
});

Deno.test("A lost checkpoint response is reconciled later instead of finishing with a stale revision", async () => {
  const f = fixture();
  f.pages.push({ messages: [message("M")], cursor: delta });
  f.failCheckpoint(new TypeError("network: private diagnostic"));
  assertEquals((await f.run()).status, "UNCONFIRMED");
  assertEquals(f.read().cursor_url, delta.url);
  assert(!f.events.some((event) => event.startsWith("defer:")));
});

Deno.test("A lost NEXT release response preserves the checkpoint and never reports a complete round", async () => {
  const f = fixture();
  f.pages.push({ messages: [], cursor: next });
  f.failFinish(new TypeError("lost response"));
  assertEquals((await f.run()).status, "UNCONFIRMED");
  assertEquals(f.read().cursor_url, next.url);
  assertEquals(f.read().initialized_at, null);
});

Deno.test("A stale lease cannot checkpoint or overwrite the replacement's error", async () => {
  const f = fixture();
  f.ports.graph.page = () => {
    throw new MicrosoftGraphSyncError("GRAPH_UNAVAILABLE", 60);
  };
  f.failDefer({ code: "55000" });
  assertEquals((await f.run()).status, "LEASE_LOST");
  assertEquals(f.passedImports.length, 0);
});

for (const scenario of ["valid", "body-only", "truncated", "bad-signature"]) {
  Deno.test(`Simulated Graph HTTP with differing metadata/raw sizes: ${scenario}`, async () => {
    const f = fixture();
    const pdf = new TextEncoder().encode("%PDF-1.7");
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const httpCalls: string[] = [];
    const receivedFiles: EmailImportAttachment[] = [];
    const retain = f.ports.sources.retain;
    f.ports.sources.retain = (id, source, files) => {
      receivedFiles.push(...files);
      return retain(id, source, files);
    };
    const metadata = (
      id: string,
      name: string,
      contentType: string,
      isInline = false,
    ) => ({
      id,
      name,
      contentType,
      isInline,
      size: 1060,
      "@odata.type": "#microsoft.graph.fileAttachment",
    });
    const client = createCustomerServiceMicrosoftGraph({
      tenantId,
      clientId: connectionId,
      clientSecret: "FAKE-TEST-SECRET",
      fetcher: ((input) => {
        const url = String(input);
        httpCalls.push(url);
        if (url.startsWith("https://login.microsoftonline.com/")) {
          return Promise.resolve(Response.json({
            access_token: "FAKE-TOKEN",
            token_type: "Bearer",
            expires_in: 3600,
          }));
        }
        if (url.includes("/messages/delta")) {
          return Promise.resolve(Response.json({
            value: [{ id: "M", webLink: message("M").webLink }],
            "@odata.deltaLink": delta.url,
          }));
        }
        if (url.includes("/attachments/PDF/$value")) {
          return Promise.resolve(
            new Response(pdf, { headers: { "Content-Length": "8" } }),
          );
        }
        if (url.includes("/attachments/PNG/$value")) {
          return Promise.resolve(
            new Response(
              scenario === "bad-signature" ? new Uint8Array(8) : png,
              {
                headers: {
                  "Content-Length": scenario === "truncated" ? "9" : "8",
                },
              },
            ),
          );
        }
        if (url.includes("/attachments?")) {
          if (scenario === "body-only") {
            return Promise.resolve(Response.json({ value: [] }));
          }
          return Promise.resolve(
            url.includes("$skiptoken=second")
              ? Response.json({
                value: [metadata("PNG", "inline.png", "image/png", true)],
              })
              : Response.json({
                value: [metadata("PDF", "source.pdf", "application/pdf")],
                "@odata.nextLink":
                  `https://graph.microsoft.com/v1.0/users/${mailboxId}/mailFolders/Folder/messages/M/attachments?$skiptoken=second`,
              }),
          );
        }
        return Promise.resolve(
          Response.json({ ...message("M"), hasAttachments: false }),
        );
      }) as typeof fetch,
    });
    const result = await syncCustomerServiceEmailPage(
      { connectionId, ...f.ports, graph: client } as unknown as Parameters<
        typeof syncCustomerServiceEmailPage
      >[0],
    );
    assertEquals(result.status, "ROUND_COMPLETE");
    assertEquals(f.receipts.get("M")!.requestId, null);
    assertEquals(f.passedImports, [[idFor(1)]]);
    if (["truncated", "bad-signature"].includes(scenario)) {
      assertEquals(f.receipts.get("M")!.sourceStatus, "REJECTED");
      assertEquals(f.receipts.get("M")!.status, "NEEDS_ATTENTION");
      assertEquals(f.retainedSources.length, 0);
      assert(!f.events.some((event) => event.startsWith("retain:")));
      assert(
        f.events.includes(
          scenario === "truncated"
            ? "reject:ATTACHMENT_SIZE"
            : "reject:ATTACHMENT_SIGNATURE",
        ),
      );
      return;
    }
    assertEquals(
      receivedFiles.map((file) => [file.id, file.file.size, file.isInline]),
      scenario === "body-only" ? [] : [["PDF", 8, false], ["PNG", 8, true]],
    );
    assertEquals(httpCalls.length, scenario === "body-only" ? 4 : 7);
    assertEquals(f.receipts.get("M")!.sourceStatus, "AVAILABLE");
    assertEquals(f.retainedSources[0].body, message("M").body);
  });
}

const secret = "fake-test-secret-at-least-thirty-two-characters";
const idle: EmailSyncResult = {
  status: "IDLE",
  connectionId,
  retained: 0,
  replayed: 0,
  removed: 0,
  baselineSkipped: 0,
  importIds: [],
};
function handlerFixture(
  overrides: Partial<
    Parameters<typeof createCustomerServiceEmailSyncHandler>[0]
  > = {},
) {
  const calls: string[] = [];
  const handler = createCustomerServiceEmailSyncHandler({
    secret,
    enabled: true,
    credentialsConfigured: true,
    run: (id) => {
      calls.push(id);
      return Promise.resolve(idle);
    },
    ...overrides,
  });
  const request = (
    body = JSON.stringify({ connectionId }),
    supplied = secret,
  ) =>
    new Request("https://test.invalid/sync", {
      method: "POST",
      headers: { "x-valtrim-email-sync-secret": supplied },
      body,
    });
  return { handler, calls, request };
}

Deno.test("Sync endpoint rejects anonymous/browser requests, disabled mode and missing configuration before execution", async () => {
  for (
    const [overrides, supplied, expected] of [
      [{}, "wrong", 401],
      [{ enabled: false }, secret, 409],
      [{ secret: "" }, secret, 503],
      [{ credentialsConfigured: false }, secret, 503],
    ] as const
  ) {
    const f = handlerFixture(overrides);
    assertEquals(
      (await f.handler(f.request(undefined, supplied))).status,
      expected,
    );
    assertEquals(f.calls, []);
  }
  const f = handlerFixture();
  assertEquals(
    (await f.handler(new Request("https://test.invalid/sync"))).status,
    405,
  );
});

Deno.test("Sync endpoint requires one explicit connection UUID and rejects frontend credentials or extra parameters", async () => {
  const f = handlerFixture();
  for (
    const body of [
      "{}",
      "null",
      "[]",
      "bad json",
      JSON.stringify({ connectionId: "bad" }),
      JSON.stringify({ connectionId, enabled: true }),
      JSON.stringify({ connectionId, clientSecret: "do not accept" }),
    ]
  ) assertEquals((await f.handler(f.request(body))).status, 400);
  assertEquals((await f.handler(f.request(" ".repeat(1025)))).status, 413);
  assertEquals(f.calls, []);
  assertEquals((await f.handler(f.request())).status, 200);
  assertEquals(f.calls, [connectionId]);
});

Deno.test("Sync endpoint exposes sanitized outcomes and Retry-After, never raw execution errors", async () => {
  const failed = handlerFixture({
    run: () =>
      Promise.resolve({
        ...idle,
        status: "FAILED",
        errorCode: "GRAPH_THROTTLED",
        retryAfterSeconds: 120,
      }),
  });
  const response = await failed.handler(failed.request());
  assertEquals(response.status, 503);
  assertEquals(response.headers.get("retry-after"), "120");
  const thrown = handlerFixture({
    run: () => {
      throw new Error("private-token-and-provider-url");
    },
  });
  assertEquals(await (await thrown.handler(thrown.request())).json(), {
    error: "SYNC_EXECUTION_NOT_CONFIRMED",
  });
});
