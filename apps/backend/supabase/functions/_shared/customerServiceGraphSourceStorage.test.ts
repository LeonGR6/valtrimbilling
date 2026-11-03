import { assert, assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import {
  EmailAttachmentValidationError,
  type EmailImportAttachment,
} from "./customerServiceEmailAttachments.ts";
import {
  graphSourceStorage,
  retainGraphEmailSource,
} from "./customerServiceGraphSourceStorage.ts";
import type { EmailConnectionState } from "./customerServiceEmailConnection.ts";
import { containsEmailBinary } from "./customerServiceEmailSourcePolicy.ts";

const importId = "30000000-0000-0000-0000-000000000003";
const connection = {
  id: "40000000-0000-0000-0000-000000000004",
  sync_token: "50000000-0000-0000-0000-000000000005",
  revision: 7,
} as EmailConnectionState;
const source = {
  body: { contentType: "text", content: "Homeowner and door work" },
};
const marker = "IMAGE-BINARY-MUST-NOT-PERSIST";
const png = new File(
  [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), marker],
  "inline.png",
  { type: "image/png" },
);
const pdf = new File(["%PDF-1.7\nPDF original"], "order.pdf", {
  type: "application/octet-stream",
});
const files = (): EmailImportAttachment[] => [{
  id: "I",
  file: png,
  isInline: true,
  contentId: "logo@id",
}, { id: "P", file: pdf }];

function transport(
  options: {
    malformed?: boolean;
    loseUpload?: boolean;
    loseFinalize?: boolean;
    missingV2?: boolean;
    changedPin?: boolean;
  } = {},
) {
  const calls: Array<
    {
      path: string;
      body: Record<string, unknown> | null;
      method: string;
      upload: File | null;
    }
  > = [];
  let finalized = false;
  const admin = createClient("https://supabase.test", "server-test-key", {
    db: { schema: "valtrim" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : null;
        const upload = init?.body instanceof FormData
          ? [...init.body.values()].find((part) => part instanceof File) as File
          : null;
        const method = init?.method ?? "GET";
        calls.push({ path, body, method, upload });
        if (path.includes("/storage/")) {
          if (method === "POST" && options.loseUpload) {
            return Response.json(
              { message: "Untrusted signed-url credential" },
              { status: 503 },
            );
          }
          if (method === "GET") return new Response(await pdf.arrayBuffer());
          return Response.json({ Key: path });
        }
        const result = {
          importId,
          requestId: null,
          sourceStatus: finalized ? "AVAILABLE" : "UPLOADING",
          status: "PENDING",
        };
        if (path.endsWith("prepare_customer_service_graph_source_v2")) {
          if (options.missingV2) {
            return Response.json({ code: "42883", message: "Missing RPC" }, {
              status: 404,
            });
          }
          if (options.changedPin) {
            return Response.json({
              code: "55000",
              message: "The pinned original email source cannot be replaced",
            }, { status: 409 });
          }
          return Response.json({
            ...result,
            sourceContractVersion: 2,
            attachments: body.p_attachments.map((
              file: Record<string, unknown>,
              index: number,
            ) =>
              file.mimeType === "application/pdf"
                ? {
                  ...file,
                  retention: "STORED",
                  objectPath: `imports/${importId}/${
                    String(index + 1).padStart(2, "0")
                  }-${file.sha256}.pdf`,
                }
                : {
                  ...file,
                  retention: options.malformed ? "STORED" : "GRAPH_ONLY",
                }
            ),
          });
        }
        if (path.endsWith("finalize_customer_service_import_source")) {
          finalized = true;
          if (options.loseFinalize) {
            return Response.json(
              { message: "Untrusted signed-url credential" },
              { status: 503 },
            );
          }
          return Response.json({ ...result, sourceStatus: "AVAILABLE" });
        }
        if (path.endsWith("fail_customer_service_import_source")) {
          return Response.json({
            ...result,
            status: finalized ? "PENDING" : "NEEDS_ATTENTION",
          });
        }
        throw new Error("Unexpected operation: " + path);
      },
    },
  });
  return {
    calls,
    admin,
    run: (attachments: EmailImportAttachment[], body = source) =>
      retainGraphEmailSource({
        importId,
        source: body,
        attachments,
        port: graphSourceStorage(admin, importId, connection),
      }),
  };
}

Deno.test("Graph V2 keeps inline image metadata and uploads only the PDF, never image bytes in RPC JSON", async () => {
  const f = transport();
  assertEquals((await f.run(files())).sourceStatus, "AVAILABLE");
  const uploads = f.calls.filter((call) => call.upload);
  assertEquals(uploads.length, 1);
  assertEquals(uploads[0].upload!.type, "application/pdf");
  assertEquals(
    new Uint8Array(await uploads[0].upload!.arrayBuffer()),
    new Uint8Array(await pdf.arrayBuffer()),
  );
  assert(f.calls[0].path.endsWith("prepare_customer_service_graph_source_v2"));
  assertEquals(f.calls[0].body!.p_connection_id, connection.id);
  assertEquals(f.calls[0].body!.p_sync_token, connection.sync_token);
  assertEquals(f.calls[0].body!.p_expected_revision, 7);
  const manifest = f.calls[0].body!.p_attachments as Array<
    Record<string, unknown>
  >;
  assertEquals(manifest[0].contentId, "logo@id");
  assertEquals(manifest[0].isInline, true);
  assertEquals(
    JSON.stringify(f.calls.map((call) => call.body)).includes(marker),
    false,
  );
  assertEquals(containsEmailBinary(f.calls.map((call) => call.body)), false);
  assertEquals(
    f.calls.some((call) =>
      call.path.endsWith("prepare_customer_service_import_source")
    ),
    false,
  );
});

for (const attachments of [[], files().slice(0, 1)]) {
  Deno.test(`Graph V2 finalizes ${attachments.length ? "image-only" : "attachment-free"} mail without any Storage request`, async () => {
    const f = transport();
    assertEquals((await f.run(attachments)).sourceStatus, "AVAILABLE");
    assertEquals(
      f.calls.filter((call) => call.path.includes("/storage/")).length,
      0,
    );
  });
}

Deno.test("A bad image after a valid PDF rejects the whole set before SQL pinning or uploads", async () => {
  const f = transport();
  await assertRejects(
    () =>
      f.run([{ id: "P", file: pdf }, {
        id: "I",
        file: new File(["invalid"], "bad.png", { type: "image/png" }),
      }]),
    EmailAttachmentValidationError,
  );
  assertEquals(f.calls.length, 0);
});

Deno.test("Seven inline/attached images create seven manifest entries and zero Storage requests", async () => {
  const f = transport();
  await f.run(
    Array.from(
      { length: 7 },
      (_, index) => ({ id: `image-${index}`, file: png, isInline: index < 4 }),
    ),
  );
  assertEquals((f.calls[0].body!.p_attachments as unknown[]).length, 7);
  assertEquals(
    f.calls.filter((call) => call.path.includes("/storage/")).length,
    0,
  );
  assertEquals(
    JSON.stringify(f.calls.map((call) => call.body)).includes(marker),
    false,
  );
});

Deno.test("A malformed returned image policy stops before uploading even a valid PDF", async () => {
  const f = transport({ malformed: true });
  assertEquals((await f.run(files())).status, "NEEDS_ATTENTION");
  assertEquals(
    f.calls.filter((call) => call.path.includes("/storage/")).length,
    0,
  );
  assertEquals(JSON.stringify(f.calls).includes("Untrusted"), false);
});

Deno.test("Image data URIs in HTML are rejected before persisting a body or PDF", async () => {
  const f = transport();
  await assertRejects(
    () =>
      f.run(files(), {
        body: {
          contentType: "html",
          content: '<img src="data:image/png;base64,forbidden">',
        },
      }),
    EmailAttachmentValidationError,
  );
  assertEquals(f.calls.length, 0);
});

Deno.test("A missing V2 RPC fails closed without falling back to historical image storage", async () => {
  const f = transport({ missingV2: true });
  await assertRejects(() => f.run(files()));
  assertEquals(f.calls.length, 1);
});

Deno.test("A changed pinned image becomes a sanitized validation problem before any upload", async () => {
  const f = transport({ changedPin: true });
  await assertRejects(() => f.run(files()), EmailAttachmentValidationError);
  assertEquals(f.calls.length, 1);
});

Deno.test("A concurrent human recovery wins even when its original source is still UPLOADING", async () => {
  const f = transport();
  const storage = graphSourceStorage(f.admin, importId, connection);
  const result = await retainGraphEmailSource({ importId, source, attachments: files(), port: {
    ...storage,
    prepare: () => Promise.resolve({ importId, requestId: 876, sourceStatus: "UPLOADING", status: "PROCESSED", idempotentReplay: true }),
  } });
  assertEquals(result.requestId, 876);
  assertEquals(f.calls.length, 0);
});

Deno.test("A lost PDF upload response is recovered by bytes/hash, without an image upload or replacement", async () => {
  const f = transport({ loseUpload: true });
  assertEquals((await f.run(files())).sourceStatus, "AVAILABLE");
  assertEquals(
    f.calls.filter((call) => call.path.includes("/storage/")).length,
    2,
  );
  assertEquals(
    f.calls.filter((call) => call.upload).every((call) =>
      call.upload!.type === "application/pdf"
    ),
    true,
  );
});

Deno.test("Lost finalization and duplicate replay preserve the source without image uploads or leaked errors", async () => {
  const f = transport({ loseFinalize: true });
  assertEquals((await f.run(files())).sourceStatus, "AVAILABLE");
  assertEquals((await f.run(files())).sourceStatus, "AVAILABLE");
  assertEquals(f.calls.filter((call) => call.upload).length, 1);
  assertEquals(
    JSON.stringify(f.calls.map((call) => call.body)).includes("Untrusted"),
    false,
  );
});
