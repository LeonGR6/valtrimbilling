import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { graphImageDownloader } from "./customerServiceGraphImageSource.ts";
import {
  graphAnalysisFixture,
  importPng,
} from "./customerServiceEmailTestFixtures.ts";
import {
  acceptedAnalysisAttachments,
  type ImageAnalysisAttachment,
} from "./customerServiceEmailAnalysisSources.ts";
import { EmailImportContinuation } from "./customerServiceEmailRuntime.ts";
import { MicrosoftGraphSyncError } from "./customerServiceMicrosoftGraph.ts";

const credentials = {
  tenantId: "00000000-0000-4000-8000-000000000011",
  clientId: "00000000-0000-4000-8000-000000000012",
  clientSecret: "test-secret",
};
async function loaderFixture() {
  const { receipt } = await graphAnalysisFixture([importPng(), importPng()]);
  const data: Record<string, unknown> = {
    importId: receipt.id,
    connectionId: receipt.sourceConnectionId,
    connectionAvailable: true,
    tenantId: credentials.tenantId,
    mailboxId: "00000000-0000-4000-8000-000000000013",
    folderId: "original-folder",
    messageId: "immutable-message",
    retryNotBefore: null,
    images: receipt.sourceManifest,
  };
  const calls: string[] = [];
  const db = createClient("https://supabase.test", "system-key", {
    db: { schema: "valtrim" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) => {
        calls.push(String(url));
        assertEquals(
          String(url).endsWith("/rpc/read_customer_service_graph_image_source"),
          true,
        );
        assertEquals(JSON.parse(String(init?.body)), {
          p_import_id: receipt.id,
          p_worker_token: "worker-lease",
        });
        return Promise.resolve(Response.json(data));
      },
    },
  });
  const http: string[] = [];
  const fetcher: typeof fetch = (url, init) => {
    http.push(String(url));
    if (String(url).startsWith("https://login.microsoftonline.com/")) {
      return Promise.resolve(
        Response.json({
          access_token: "ephemeral-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      );
    }
    assertEquals(
      new Headers(init?.headers).get("authorization"),
      "Bearer ephemeral-token",
    );
    assertEquals(
      new Headers(init?.headers).get("prefer"),
      'IdType="ImmutableId"',
    );
    return Promise.resolve(new Response(importPng()));
  };
  const images = acceptedAnalysisAttachments(
    receipt,
  ) as ImageAnalysisAttachment[];
  return { receipt, data, calls, db, http, fetcher, images };
}

Deno.test("Graph image reader resolves its bound origin once and reuses only the in-memory token", async () => {
  const f = await loaderFixture();
  const download = graphImageDownloader(f.db, f.receipt, "worker-lease", {
    credentials,
    fetcher: f.fetcher,
  });
  assertEquals(f.calls, []); // Lazy: even the origin is not read for reused analyses.
  for (const image of f.images) {
    assertEquals((await download(image)).size, importPng().size);
  }
  assertEquals(f.calls.length, 1);
  assertEquals(f.http.length, 3);
  assertEquals(
    f.http.slice(1).every((url) =>
      url.includes(
        "/mailFolders/original-folder/messages/immutable-message/attachments/file-",
      ) && url.endsWith("/$value")
    ),
    true,
  );
});

Deno.test("Graph image reader rejects foreign metadata and unavailable connections before fetching bytes", async () => {
  for (
    const field of ["connectionId", "importId", "connectionAvailable", "images"]
  ) {
    const f = await loaderFixture();
    f.data[field] = field === "connectionAvailable"
      ? false
      : field === "images"
      ? []
      : "foreign";
    const download = graphImageDownloader(f.db, f.receipt, "worker-lease", {
      credentials,
      fetcher: f.fetcher,
    });
    await assertRejects(() => download(f.images[0]));
    assertEquals(f.http, []);
  }
});

Deno.test("Graph image reader honors connection Retry-After with a cooperative continuation", async () => {
  const f = await loaderFixture();
  f.data.retryNotBefore = "2026-10-28T12:05:00Z";
  const download = graphImageDownloader(f.db, f.receipt, "worker-lease", {
    credentials,
    fetcher: f.fetcher,
    now: () => Date.parse("2026-10-28T12:00:00Z"),
  });
  const error = await assertRejects(
    () => download(f.images[0]),
    EmailImportContinuation,
  ) as EmailImportContinuation;
  assertEquals(error.retryAfterSeconds, 300);
  assertEquals(f.http, []);
});

Deno.test("Graph image reader validates configured tenant and requires the worker lease", async () => {
  for (
    const mode of ["missing-credentials", "foreign-tenant", "missing-lease"]
  ) {
    const f = await loaderFixture();
    const download = graphImageDownloader(
      f.db,
      f.receipt,
      mode === "missing-lease" ? undefined : "worker-lease",
      {
        credentials: mode === "missing-credentials"
          ? undefined
          : { ...credentials, tenantId: "other-tenant" },
        fetcher: f.fetcher,
      },
    );
    await assertRejects(() => download(f.images[0]));
    assertEquals(f.http, []);
  }
});

Deno.test("Graph failures expose safe retry diagnostics and never response content", async () => {
  for (const status of [429, 503, 403, 404]) {
    const f = await loaderFixture();
    const download = graphImageDownloader(f.db, f.receipt, "worker-lease", {
      credentials,
      fetcher: (url, init) =>
        String(url).startsWith("https://login.")
          ? f.fetcher(url, init)
          : Promise.resolve(
            new Response("secret signed URL raw body", {
              status,
              headers: { "retry-after": "1200" },
            }),
          ),
    });
    const error = await assertRejects(() => download(f.images[0]));
    assertEquals(JSON.stringify(error).includes("secret"), false);
    if ([429, 503].includes(status)) {
      assertEquals(error instanceof MicrosoftGraphSyncError, true);
      assertEquals((error as MicrosoftGraphSyncError).retryAfterSeconds, 1200);
    }
  }
});

Deno.test("Graph image reader yields when its deadline is exhausted instead of consuming a source failure", async () => {
  const f = await loaderFixture();
  const download = graphImageDownloader(f.db, f.receipt, "worker-lease", {
    credentials,
    fetcher: f.fetcher,
    now: () => 100,
    deadline: 99,
  });
  await assertRejects(() => download(f.images[0]), EmailImportContinuation);
  assertEquals(f.http, []);
});
