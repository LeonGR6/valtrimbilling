import { assertEquals, assertRejects } from "@std/assert";
import { customerServiceEmailSyncStorage } from "./customerServiceEmailSyncStorage.ts";

const target = {
  tenantId: "10000000-0000-0000-0000-000000000001",
  mailboxId: "20000000-0000-0000-0000-000000000002",
  folderId: "Folder",
};
const importId = "30000000-0000-0000-0000-000000000003";
const message = {
  id: "M+/=",
  subject: "Request",
  webLink: "https://outlook.office.com/mail/source",
  body: { contentType: "text", content: "must-not-register-before-validation" },
  contentBytes: "must-not-copy",
};

function fixture(
  overrides: Record<string, unknown> = {},
  readError: unknown = null,
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const row = {
    id: importId,
    tenant_id: target.tenantId,
    mailbox_id: target.mailboxId,
    provider_message_id: message.id,
    source_status: "PENDING",
    status: "PENDING",
    request_id: null,
    source_payload: { webLink: message.webLink },
    source_manifest: null,
    source_contract_version: 1,
    source_connection_id: null,
    ...overrides,
  };
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: name === "register_customer_service_email_import"
          ? { importId }
          : {
            importId,
            sourceStatus: "REJECTED",
            status: "NEEDS_ATTENTION",
            requestId: null,
          },
        error: null,
      });
    },
    from: (table: string) => ({
      select: (_fields: string) => ({
        eq: (_key: string, _id: string) => ({
          maybeSingle: () => {
            if (table !== "service_request_imports") {
              throw new Error(
                "Wrong table",
              );
            }
            return Promise.resolve({ data: row, error: readError });
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof customerServiceEmailSyncStorage>[0];
  return { sources: customerServiceEmailSyncStorage(admin), calls, row };
}

Deno.test("Graph storage registers only minimal metadata with the canonical mailbox identity", async () => {
  const f = fixture();
  const result = await f.sources.register(target, message);
  assertEquals(result.importId, importId);
  assertEquals(f.calls, [{
    name: "register_customer_service_email_import",
    args: {
      p_tenant_id: target.tenantId,
      p_mailbox_id: target.mailboxId,
      p_provider_message_id: message.id,
      p_source_payload: { subject: message.subject, webLink: message.webLink },
    },
  }]);
});

Deno.test("Graph storage refuses unconfirmed or cross-mailbox receipt responses", async () => {
  for (
    const overrides of [
      { tenant_id: target.mailboxId },
      { mailbox_id: "victor@example.test" },
      { provider_message_id: "another-message" },
      { id: "different" },
    ]
  ) {
    await assertRejects(
      () => fixture(overrides).sources.register(target, message),
      Error,
      "identity was not confirmed",
    );
  }
  await assertRejects(
    () =>
      fixture({}, new Error("read unavailable")).sources.register(
        target,
        message,
      ),
    Error,
    "read unavailable",
  );
});

Deno.test("Graph storage preserves pinned snapshots and existing business requests on replay", async () => {
  const f = fixture({
    source_status: "AVAILABLE",
    status: "PROCESSED",
    request_id: 596,
    source_payload: { body: { contentType: "text", content: "original" } },
    source_manifest: [],
  });
  const receipt = await f.sources.register(target, {
    ...message,
    body: { contentType: "text", content: "external edit" },
  });
  assertEquals(receipt.requestId, 596);
  assertEquals(receipt.source, {
    body: { contentType: "text", content: "original" },
  });
  assertEquals(f.calls.length, 1);
});

Deno.test("Graph storage reuses the existing durable rejection and pinned failure contracts", async () => {
  const f = fixture();
  await f.sources.reject(
    importId,
    "ATTACHMENT_COUNT",
    "El correo supera 10 archivos.",
  );
  await f.sources.failPinned(importId);
  assertEquals(f.calls.map((call) => call.name), [
    "reject_customer_service_import_source",
    "fail_customer_service_import_source",
  ]);
  assertEquals(f.calls[0].args.p_import_id, importId);
  assertEquals(f.calls[1].args.p_import_id, importId);
});

Deno.test("Binary text in an invalid filename cannot leak through the technical rejection message", async () => {
  const f = fixture();
  await f.sources.reject(importId, "ATTACHMENT_SIGNATURE", "El archivo data:image/png;base64,PRIVATE_IMAGE_PAYLOAD no coincide con su formato.");
  assertEquals(JSON.stringify(f.calls).includes("PRIVATE_IMAGE_PAYLOAD"), false);
  assertEquals(f.calls[0].args.p_error_code, "ATTACHMENT_SIGNATURE");
});
