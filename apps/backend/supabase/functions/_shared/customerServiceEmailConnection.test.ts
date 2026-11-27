import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createCustomerServiceEmailConnectionRepository,
  type EmailConnectionState,
  validateEmailSyncCursor,
} from "./customerServiceEmailConnection.ts";

const tenantId = "10000000-0000-0000-0000-000000000001";
const mailboxId = "20000000-0000-0000-0000-000000000002";
const connectionId = "30000000-0000-0000-0000-000000000003";
const syncToken = "40000000-0000-0000-0000-000000000004";
const importId = "50000000-0000-0000-0000-000000000005";
const target = { tenantId, mailboxId, folderId: "Folder+/=" };

Deno.test("resolved message lookup uses the exact connection lease and validates returned identities", async () => {
  const f = fixture(["Related+/="]);
  assertEquals(
    await f.repository.resolvedMatches(claimed(), ["Related+/=", "New"]),
    ["Related+/="],
  );
  assertEquals(f.calls[0], {
    name: "read_customer_service_email_resolved_matches",
    args: {
      p_connection_id: connectionId,
      p_sync_token: syncToken,
      p_expected_revision: 3,
      p_message_ids: ["Related+/=", "New"],
    },
  });
  for (const invalid of [["Other"], ["Related", "Related"], null]) {
    await assertRejects(() =>
      fixture(invalid).repository.resolvedMatches(claimed(), ["Related"])
    );
  }
  const invalidPage = fixture([]);
  for (
    const ids of [
      [""],
      [" X"],
      ["bad\nidentity"],
      ["X".repeat(2049)],
      Array(1001).fill("X"),
    ]
  ) {
    await assertRejects(() =>
      invalidPage.repository.resolvedMatches(claimed(), ids)
    );
  }
  await assertRejects(() =>
    invalidPage.repository.resolvedMatches(row(), ["X"])
  );
  assertEquals(invalidPage.calls.length, 0);
});

Deno.test("resolved message lookup cannot turn a database or lease failure into an empty match", async () => {
  const f = fixture(null, { code: "55000", message: "Expired lease" });
  await assertRejects(() =>
    f.repository.resolvedMatches(claimed(), ["Related"])
  );
});
const base =
  `https://graph.microsoft.com/v1.0/users/${mailboxId}/mailFolders/Folder%2B%2F%3D/messages/delta`;
const next = {
  kind: "NEXT" as const,
  url: `${base}?%24skiptoken=Opaque%2BValue&%24select=id`,
};
const delta = {
  kind: "DELTA" as const,
  url: `${base}?$deltatoken=OtherOpaqueValue`,
};
function row(
  overrides: Partial<EmailConnectionState> = {},
): EmailConnectionState {
  return {
    id: connectionId,
    tenant_id: tenantId,
    mailbox_id: mailboxId,
    folder_id: target.folderId,
    enabled: false,
    initial_sync_mode: null,
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
    created_at: "2026-10-23T18:00:00.000001Z",
    updated_at: "2026-10-23T18:00:00.000001Z",
    ...overrides,
  };
}
const claimed = () =>
  row({
    enabled: true,
    initial_sync_mode: "IMPORT_EXISTING",
    revision: 3,
    attempt_count: 1,
    sync_token: syncToken,
    sync_lease_expires_at: "2026-10-23T18:03:00Z",
    last_attempt_at: "2026-10-23T18:00:00Z",
  });
function fixture(data: unknown = row(), error: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data, error });
    },
  } as unknown as Parameters<
    typeof createCustomerServiceEmailConnectionRepository
  >[0];
  return {
    calls,
    repository: createCustomerServiceEmailConnectionRepository(client),
  };
}

Deno.test("connection registration forwards only non-secret identities and leaves policy unselected", async () => {
  const { calls, repository } = fixture();
  const result = await repository.register(
    { ...target, clientSecret: "must-not-forward" } as typeof target,
  );
  assertEquals(result.enabled, false);
  assertEquals(calls, [{
    name: "register_customer_service_email_connection",
    args: {
      p_tenant_id: tenantId,
      p_mailbox_id: mailboxId,
      p_folder_id: target.folderId,
      p_initial_sync_mode: null,
    },
  }]);
});

Deno.test("invalid connection identities and modes make no RPC calls", async () => {
  const { calls, repository } = fixture();
  for (
    const invalid of [
      { ...target, tenantId: "invalid" },
      { ...target, mailboxId: "user@example.com" },
      { ...target, folderId: " " },
      { ...target, folderId: "folder\n" },
      { ...target, folderId: "x".repeat(2049) },
    ]
  ) {
    await assertRejects(() => repository.register(invalid));
  }
  await assertRejects(() =>
    repository.register(target, "GUESS" as "IMPORT_EXISTING")
  );
  assertEquals(calls.length, 0);
});

Deno.test("Graph cursors retain the full opaque URL and decode only the target path", () => {
  assertEquals(validateEmailSyncCursor(target, next), next);
  assertEquals(validateEmailSyncCursor(target, delta), delta);
  const lowerEscapes = {
    ...next,
    url: next.url.replace("Folder%2B%2F%3D", "Folder%2b%2f%3d"),
  };
  assertEquals(validateEmailSyncCursor(target, lowerEscapes), lowerEscapes);
});

Deno.test("Graph OData folder keys retain exact NEXT and DELTA links with the configured case-sensitive identity", () => {
  for (const cursor of [next, delta]) {
    const keyed = {
      ...cursor,
      url: cursor.url.replace(
        "/mailFolders/Folder%2B%2F%3D/",
        "/mailFolders('Folder%2B%2F%3D')/",
      ),
    };
    assertEquals(validateEmailSyncCursor(target, keyed), keyed);
    const encodedQuotes = {
      ...keyed,
      url: keyed.url.replace("mailFolders('", "mailFolders(%27").replace(
        "')/",
        "%27)/",
      ),
    };
    assertEquals(validateEmailSyncCursor(target, encodedQuotes), encodedQuotes);
  }
  const quotedTarget = { ...target, folderId: "Folder's+/=" };
  const quoted = {
    ...next,
    url: next.url.replace(
      "/mailFolders/Folder%2B%2F%3D/",
      "/mailFolders('Folder''s%2B%2F%3D')/",
    ),
  };
  assertEquals(validateEmailSyncCursor(quotedTarget, quoted), quoted);
});

Deno.test("OData folder-key cursors reject scope changes, malformed literals, traversal and token confusion", () => {
  const keyed = next.url.replace(
    "/mailFolders/Folder%2B%2F%3D/",
    "/mailFolders('Folder%2B%2F%3D')/",
  );
  for (
    const url of [
      keyed.replace(mailboxId, tenantId),
      keyed.replace("Folder", "folder"),
      keyed.replace("graph.microsoft.com", "graph.microsoft.com.evil.test"),
      keyed.replace("graph.microsoft.com", "user:password@graph.microsoft.com"),
      keyed.replace("graph.microsoft.com", "graph.microsoft.com:443"),
      keyed.replace("')/messages", ")/messages"),
      keyed.replace("')/messages", "')extra/messages"),
      keyed.replace("Folder%2B%2F%3D", "Folder%252B%252F%253D"),
      keyed.replace("Folder%2B%2F%3D", "Folder'Injected"),
      keyed.replace("/messages/delta", "/messages/delta/extra"),
      keyed.replace("/messages/delta", "/../messages/delta"),
      keyed.replace("/messages/delta", "/%2e/messages/delta"),
      keyed + "&$skiptoken=duplicate",
      keyed + "&$deltatoken=other",
      keyed + "#fragment",
    ]
  ) assertThrows(() => validateEmailSyncCursor(target, { kind: "NEXT", url }));
});

Deno.test("Graph cursor validation rejects other hosts, endpoints, folders and token confusion", () => {
  const invalid = [
    next.url.replace("https:", "http:"),
    next.url.replace("graph.microsoft.com", "graph.microsoft.com.evil.test"),
    next.url.replace(
      "graph.microsoft.com",
      "user:password@graph.microsoft.com",
    ),
    next.url.replace("graph.microsoft.com", "graph.microsoft.com:443"),
    next.url.replace(mailboxId, tenantId),
    next.url.replace("Folder%2B%2F%3D", "Different"),
    next.url.replace("/messages/delta", "/messages"),
    next.url + "#fragment",
    next.url + "\n",
    next.url.replace("%2B", "%ZZ"),
    next.url.replace("%24skiptoken", "$deltatoken"),
    `${base}?$skiptoken=`,
    `${base}?$skiptoken=one&$skiptoken=two`,
    `${base}?$skiptoken=one&$deltatoken=`,
    `${base}?$skiptoken=one&$deltatoken=two`,
    `${base}?$skiptoken=one\\two`,
  ];
  for (const url of invalid) {
    assertThrows(() => validateEmailSyncCursor(target, { kind: "NEXT", url }));
  }
});

Deno.test("connection reads and claims are scoped to one explicit identity", async () => {
  const idle = fixture(null);
  assertEquals(await idle.repository.claim(connectionId), null);
  assertEquals(idle.calls[0], {
    name: "claim_customer_service_email_sync",
    args: { p_connection_id: connectionId },
  });
  const active = fixture(claimed());
  assertEquals(
    (await active.repository.claim(connectionId))?.sync_token,
    syncToken,
  );
  assertEquals(
    (await fixture().repository.read(connectionId)).id,
    connectionId,
  );
  await assertRejects(() => idle.repository.claim(""));
  assertEquals(idle.calls.length, 1);
});

Deno.test("configuration uses exact canonical revision and an explicit activation flag", async () => {
  const { calls, repository } = fixture(row({ revision: 2 }));
  await repository.configure(row(), false, "BASELINE_ONLY");
  assertEquals(calls[0], {
    name: "configure_customer_service_email_connection",
    args: {
      p_connection_id: connectionId,
      p_expected_revision: 1,
      p_enabled: false,
      p_initial_sync_mode: "BASELINE_ONLY",
    },
  });
  await assertRejects(() =>
    repository.configure(row(), undefined as unknown as boolean)
  );
  assertEquals(calls.length, 1);
});

Deno.test("page checkpoint forwards the fencing token, revision, full cursor and durable receipt IDs", async () => {
  const result = row({
    ...claimed(),
    revision: 4,
    cursor_kind: "NEXT",
    cursor_url: next.url,
  });
  const { calls, repository } = fixture(result);
  assertEquals(
    await repository.checkpoint(claimed(), next, [importId]),
    result,
  );
  assertEquals(calls[0], {
    name: "checkpoint_customer_service_email_sync",
    args: {
      p_connection_id: connectionId,
      p_expected_revision: 3,
      p_sync_token: syncToken,
      p_cursor_kind: "NEXT",
      p_cursor_url: next.url,
      p_import_ids: [importId],
    },
  });
});

Deno.test("invalid page, missing reservation and bad cursor cannot write a checkpoint", async () => {
  const { calls, repository } = fixture();
  await assertRejects(() => repository.checkpoint(row(), next));
  await assertRejects(() => repository.checkpoint(claimed(), next, ["bad"]));
  await assertRejects(() =>
    repository.checkpoint(claimed(), next, Array(1001).fill(importId))
  );
  await assertRejects(() =>
    repository.checkpoint(claimed(), {
      ...next,
      url: next.url.replace("Folder", "Other"),
    })
  );
  assertEquals(calls.length, 0);
});

Deno.test("finish distinguishes a yield from a sanitized failure without inventing success", async () => {
  const { calls, repository } = fixture(
    row({ ...claimed(), sync_token: null, sync_lease_expires_at: null }),
  );
  const result = await repository.finish(claimed());
  assertEquals(result.last_success_at, null);
  assertEquals(calls[0].args.p_error_code, null);
  await repository.finish(claimed(), "AUTH_FAILED");
  assertEquals(calls[1].args.p_error_code, "AUTH_FAILED");
  assertEquals(Object.keys(calls[1].args).sort(), [
    "p_connection_id",
    "p_error_code",
    "p_expected_revision",
    "p_sync_token",
  ]);
});

Deno.test("RPC permission, version and lease failures propagate without optimistic state changes", async () => {
  for (const code of ["42501", "40001", "55000"]) {
    const failure = { code, message: "Server rejected operation" };
    const { calls, repository } = fixture(null, failure);
    try {
      await repository.finish(claimed(), "SYNC_ERROR");
      throw new Error("Expected failure");
    } catch (error) {
      assertEquals(error, failure);
    }
    assertEquals(calls.length, 1);
  }
});

Deno.test("unconfirmed or mismatched database responses cannot masquerade as valid state", async () => {
  for (
    const invalid of [
      null,
      {},
      row({ id: tenantId }),
      row({ revision: 0 }),
      row({ attempt_count: -1 }),
      row({ created_at: "invalid" }),
      row({ cursor_kind: "NEXT" }),
      row({ sync_token: syncToken }),
      row({ enabled: true }),
      row({ retry_not_before: "invalid" }),
    ]
  ) {
    await assertRejects(() => fixture(invalid).repository.read(connectionId));
  }
  await assertRejects(() => fixture(row()).repository.claim(connectionId));
  await assertRejects(() =>
    fixture(row({ folder_id: "wrong" })).repository.register(target)
  );
});

Deno.test("provider backoff forwards the current lease and server revision without accepting invalid delays", async () => {
  const delayed = row({
    retry_not_before: "2026-10-27T12:02:00Z",
    last_error_code: "GRAPH_THROTTLED",
    revision: 5,
  });
  const { repository, calls } = fixture(delayed);
  assertEquals(
    await repository.defer(claimed(), "GRAPH_THROTTLED", 120),
    delayed,
  );
  assertEquals(calls, [{
    name: "defer_customer_service_email_sync",
    args: {
      p_connection_id: connectionId,
      p_expected_revision: 3,
      p_sync_token: syncToken,
      p_error_code: "GRAPH_THROTTLED",
      p_retry_after_seconds: 120,
    },
  }]);
  for (const delay of [-1, NaN, 1.5, Infinity, 2_147_483_648]) {
    await assertRejects(() =>
      repository.defer(claimed(), "GRAPH_THROTTLED", delay)
    );
  }
  assertEquals(calls.length, 1);
});

Deno.test("Graph checkpoint binds baseline membership and removals to the same fenced cursor write", async () => {
  const { repository, calls } = fixture(claimed());
  await repository.checkpoint(claimed(), next, [], ["Historical+/="], [
    "Removed+/=",
  ]);
  assertEquals(calls[0], {
    name: "checkpoint_customer_service_email_graph_page",
    args: {
      p_connection_id: connectionId,
      p_sync_token: syncToken,
      p_expected_revision: 3,
      p_cursor_kind: "NEXT",
      p_cursor_url: next.url,
      p_import_ids: [],
      p_baseline_message_ids: ["Historical+/="],
      p_removed_message_ids: ["Removed+/="],
    },
  });
  const read = fixture(["Historical"]);
  assertEquals(
    await read.repository.baselineMatches(claimed(), [
      "Historical",
      "historical",
    ]),
    ["Historical"],
  );
  assertEquals(read.calls[0].args.p_sync_token, syncToken);
  await assertRejects(() =>
    fixture(["Other"]).repository.baselineMatches(claimed(), ["Historical"])
  );
});
