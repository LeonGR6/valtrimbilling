import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { persistCustomerServiceEmailSource } from "./customerServiceEmailImportStorage.ts";

const importId = "00000000-0000-4000-8000-000000000001";
const source = {
  bodyText: "Original email",
  webLink: "https://outlook.office.com/mail/",
};

function transport() {
  const calls: Array<
    {
      path: string;
      method: string;
      headers: Headers;
      body: Record<string, unknown> | null;
      uploadFile: Blob | null;
    }
  > = [];
  const client = createClient("https://supabase.test", "server-test-key", {
    db: { schema: "valtrim" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const path = new URL(String(input)).pathname;
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : null;
        const headers = new Headers(init?.headers);
        const uploadFile = init?.body instanceof FormData
          ? [...init.body.values()].find((value) => value instanceof Blob) as
            | Blob
            | undefined
          : undefined;
        calls.push({
          path,
          method: init?.method ?? "GET",
          headers,
          body,
          uploadFile: uploadFile ?? null,
        });
        const operation = path.split("/").at(-1);
        const result = {
          importId,
          requestId: null,
          status: "PENDING",
          sourceStatus: "UPLOADING",
          attachments: body?.p_attachments?.map((
            file: Record<string, unknown>,
          ) => ({
            ...file,
            objectPath: `imports/${importId}/01-${file.sha256}.pdf`,
          })),
        };
        if (operation === "finalize_customer_service_import_source") {
          result.sourceStatus = "AVAILABLE";
        }
        if (operation === "reject_customer_service_import_source") {
          result.sourceStatus = "REJECTED";
          result.status = "NEEDS_ATTENTION";
        }
        return Promise.resolve(
          new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    },
  });
  return { client, calls };
}

Deno.test("Supabase adapter uses valtrim RPCs, private deterministic objects and no upsert", async () => {
  const { client, calls } = transport();
  const result = await persistCustomerServiceEmailSource(
    client,
    importId,
    source,
    [{
      id: "pdf-1",
      file: new File(["%PDF-1.7\n"], "order.pdf", { type: "application/pdf" }),
    }],
  );
  assertEquals(result.sourceStatus, "AVAILABLE");
  assertEquals(calls.length, 3);
  assertEquals(
    calls[0].path,
    "/rest/v1/rpc/prepare_customer_service_import_source",
  );
  assertEquals(calls[0].headers.get("content-profile"), "valtrim");
  assertEquals(calls[0].body?.p_import_id, importId);
  assertEquals(calls[0].body?.p_source_payload, source);
  assertEquals(
    calls[1].path.startsWith(
      `/storage/v1/object/customer-service-imports/imports/${importId}/`,
    ),
    true,
  );
  assertEquals(calls[1].headers.get("x-upsert"), "false");
  assertEquals(
    calls[2].path,
    "/rest/v1/rpc/finalize_customer_service_import_source",
  );
  assertEquals(
    calls.some((call) =>
      call.path.includes("save_customer_service_imported_request")
    ),
    false,
  );
});

Deno.test("Supabase adapter rejects an invalid email without sending body or uploading any file", async () => {
  const { client, calls } = transport();
  const result = await persistCustomerServiceEmailSource(
    client,
    importId,
    source,
    [{
      id: "bad",
      file: new File(["not a PNG"], "photo.png", { type: "image/png" }),
    }],
  );
  assertEquals(result.sourceStatus, "REJECTED");
  assertEquals(calls.length, 1);
  assertEquals(
    calls[0].path,
    "/rest/v1/rpc/reject_customer_service_import_source",
  );
  assertEquals(calls[0].body?.p_error_code, "ATTACHMENT_SIGNATURE");
  assertEquals(calls[0].body?.p_source_payload, undefined);
});

for (const originalMime of ["application/octet-stream", ""]) {
  for (
    const [name, mimeType, signature] of [
      ["photo.jpeg", "image/jpeg", [255, 216, 255, 0]],
      ["inline.png", "image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
      ["source.pdf", "application/pdf", [37, 80, 68, 70, 45, 49, 46, 55]],
    ] as const
  ) {
    Deno.test(`Supabase multipart upload uses the validated MIME for ${name} with ${originalMime || "no provider MIME"}, preserving every byte`, async () => {
      const { client, calls } = transport();
      const bytes = new Uint8Array(signature);
      const file = new File([bytes], name, { type: originalMime });
      const result = await persistCustomerServiceEmailSource(
        client,
        importId,
        source,
        [{ id: "F", file }],
      );
      assertEquals(result.sourceStatus, "AVAILABLE");
      const uploaded = calls[1].uploadFile!;
      assertEquals(uploaded.type, mimeType);
      assertEquals(new Uint8Array(await uploaded.arrayBuffer()), bytes);
      assertEquals(file.type, originalMime);
      assertEquals(calls[1].headers.get("x-upsert"), "false");
    });
  }
}

Deno.test("Supabase adapter does not pretend an empty database response completed storage", async () => {
  const client = createClient("https://supabase.test", "server-test-key", {
    db: { schema: "valtrim" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: () =>
        Promise.resolve(
          new Response("null", {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    },
  });
  await assertRejects(
    () => persistCustomerServiceEmailSource(client, importId, source, []),
    Error,
    "Missing email source operation result",
  );
});
