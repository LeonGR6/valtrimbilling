import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createCustomerServiceMicrosoftGraph,
  type GraphFailureDiagnostic,
  MicrosoftGraphSyncError,
  graphEmailSource,
  validateGraphAttachmentMetadata,
} from "./customerServiceMicrosoftGraph.ts";
import {
  EmailAttachmentValidationError,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_TOTAL_BYTES,
  validateEmailImportAttachments,
} from "./customerServiceEmailAttachments.ts";
import { containsEmailBinary } from "./customerServiceEmailSourcePolicy.ts";

Deno.test("Graph snapshots project typed headers instead of copying provider binary properties", () => {
  const source = graphEmailSource({ id: "M", subject: "Request", body: { contentType: "text", content: "Complete body" },
    from: { emailAddress: { address: "builder@example.com", name: "Builder", contentBytes: "secret" }, bytes: [1,2,3] },
    toRecipients: [{ emailAddress: { address: "office@example.com", image_url: "forbidden" } }], contentBytes: "forbidden" });
  assertEquals(source.from, { emailAddress: { address: "builder@example.com", name: "Builder" } });
  assertEquals(source.toRecipients, [{ emailAddress: { address: "office@example.com" } }]);
  assertEquals(containsEmailBinary(source), false);
});

Deno.test("Unsafe body/header data is never persisted even inside an initial receipt", () => {
  const unsafe = { id: "M", subject: "data:image/png;base64,forbidden", webLink: "https://outlook.office.com/mail/original",
    body: { contentType: "html", content: '<img src="data:image/png;base64,forbidden">' } };
  assertEquals(graphEmailSource(unsafe, false), { webLink: unsafe.webLink });
  const error = assertThrows(() => graphEmailSource(unsafe), EmailAttachmentValidationError);
  assertEquals(error.message.includes("forbidden"), false);
  assert(containsEmailBinary(new Uint8Array([1,2,3])));
});

const tenantId = "10000000-0000-0000-0000-000000000001";
const mailboxId = "20000000-0000-0000-0000-000000000002";
const clientId = "30000000-0000-0000-0000-000000000003";
const target = { tenantId, mailboxId, folderId: "Folder+/=" };
const base =
  `https://graph.microsoft.com/v1.0/users/${mailboxId}/mailFolders/Folder%2B%2F%3D/messages`;
const next = {
  kind: "NEXT" as const,
  url: `${base}/delta?$skiptoken=opaque%2Bexact`,
};
const delta = {
  kind: "DELTA" as const,
  url: `${base}/delta?$deltatoken=opaque%2Bexact`,
};
const attachment = (overrides: Record<string, unknown> = {}) => ({
  id: "File+/=",
  name: "work.pdf",
  contentType: "application/pdf",
  size: 8,
  isInline: false,
  "@odata.type": "#microsoft.graph.fileAttachment",
  ...overrides,
});

function fixture(
  replies: (
    | Response
    | ((url: string, init: RequestInit) => Response | Promise<Response>)
  )[],
  options: {
    now?: () => number;
    deadline?: number;
    requestTimeoutMs?: number;
    diagnose?: (diagnostic: GraphFailureDiagnostic) => void;
  } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createCustomerServiceMicrosoftGraph({
    tenantId,
    clientId,
    clientSecret: "FAKE-TEST-SECRET",
    // Keep the test output quiet; the diagnostics test passes its own.
    diagnose: () => {},
    ...options,
    fetcher: (async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      const reply = replies.shift();
      if (!reply) {
        throw new Error("Unexpected external request in a simulation.");
      }
      return typeof reply === "function" ? await reply(url, init) : reply;
    }) as typeof fetch,
  });
  return { client, calls };
}
const auth = () =>
  Response.json({
    access_token: "FAKE-ACCESS-TOKEN",
    token_type: "Bearer",
    expires_in: 3600,
  });
const page = (messages: unknown[] = []) =>
  Response.json({ value: messages, "@odata.deltaLink": delta.url });

Deno.test("Folder inventory requests only IDs and projects away unexpected source fields",async () => {
  const { client,calls } = fixture([auth(),Response.json({ value: [{ id: "M",body: { content: "ignored" },contentBytes: "ignored" }] })]);
  assertEquals(await client.folderMessageIds(target),{ messageIds: ["M"],webLinks: {},messageMetadata: [],nextUrl: null });
  assertEquals(calls.length,2);
  assertEquals(calls[1].url,`${base}?$select=id,webLink,subject,from,receivedDateTime&$top=100`);
  assertEquals(calls[1].init.method,"GET");
  assertEquals((calls[1].init.headers as Record<string,string>).Prefer,'IdType="ImmutableId"');
});
Deno.test("Folder inventory preserves Graph $skip and OData folder paths verbatim",async () => {
  const url = `${base.replace("mailFolders/Folder%2B%2F%3D","mailFolders('Folder%2B%2F%3D')")}?$select=id&$skip=157`;
  const { client,calls } = fixture([auth(),Response.json({ value: [],"@odata.nextLink": url }),Response.json({ value: [{ id: "M2" }] })]);
  const first = await client.folderMessageIds(target);
  assertEquals(first.nextUrl,url);
  assertEquals(await client.folderMessageIds(target,first.nextUrl),{ messageIds: ["M2"],webLinks: {},messageMetadata: [],nextUrl: null });
  assertEquals(calls[2].url,url);
});
Deno.test("Folder inventory rejects unsafe continuations before authentication",async () => {
  for (const url of [
    `https://evil.example${new URL(base).pathname}?$skip=1`,
    `${base.replace("Folder%2B%2F%3D","Other")}?$skip=1`,
    `${base}/delta?$skiptoken=x`,`${base}?$select=body&$skip=1`,
    `${base}?$expand=attachments&$skip=1`,`${base}?$skip=1&$skiptoken=x`,
  ]) {
    const { client,calls } = fixture([]);
    await assertRejects(() => client.folderMessageIds(target,url),MicrosoftGraphSyncError);
    assertEquals(calls.length,0);
  }
});
Deno.test("Folder inventory rejects partial/invalid metadata instead of truncating a page",async () => {
  for (const value of [{ value: [{ id: "valid" },{}] },{ value: [],"@odata.nextLink": 123 },{ value: [{ id: " " }] }]) {
    const { client } = fixture([auth(),Response.json(value)]);
    await assertRejects(() => client.folderMessageIds(target),MicrosoftGraphSyncError);
  }
});

Deno.test("Folder inventory retains safe original Outlook links without copying bodies or unsafe links",async () => {
  const link = "https://outlook.office365.com/owa/?ItemID=original";
  const { client } = fixture([auth(),Response.json({ value: [
    { id: "M",webLink: link,body: "never retained" },
    { id: "evil",webLink: "https://outlook.office365.com.evil.example/" },
    { id: "binary",webLink: "data:image/png;base64,forbidden" },
  ] })]);
  assertEquals(await client.folderMessageIds(target),{ messageIds: ["M","evil","binary"],webLinks: { M: link },messageMetadata: [],nextUrl: null });
});

Deno.test("Folder inventory projects readable headers without bodies, binary data or arbitrary sender fields",async () => {
  const { client } = fixture([auth(),Response.json({ value: [
    { id: "M",subject: "Warranty request",from: { emailAddress: { name: "Builder",address: "builder@example.com",bytes: "ignored" } },
      receivedDateTime: "2026-11-02T17:00:00Z",body: { content: "NEVER_COPY_BODY" },contentBytes: "NEVER_COPY_BYTES" },
    { id: "unsafe",subject: "data:image/png;base64,forbidden",from: { emailAddress: { name: "data:image/png;base64,forbidden" } },receivedDateTime: "invalid" },
  ] })]);
  const result = await client.folderMessageIds(target);
  assertEquals(result.messageMetadata,[
    { messageId: "M",subject: "Warranty request",sender: "Builder · builder@example.com",receivedAt: "2026-11-02T17:00:00Z" },
    { messageId: "unsafe",subject: null,sender: null,receivedAt: null },
  ]);
  assertEquals(JSON.stringify(result).includes("NEVER_COPY"),false);
});

Deno.test("Graph client authenticates app-only, binds tenant and sends immutable IDs without redirects", async () => {
  const { client, calls } = fixture([auth(), page([{ id: "M+/=" }])]);
  const result = await client.page(target, null);
  assertEquals(result.cursor, delta);
  assertEquals(calls.length, 2);
  assertEquals(
    calls[0].url,
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  );
  const form = calls[0].init.body as URLSearchParams;
  assertEquals(form.get("grant_type"), "client_credentials");
  assertEquals(form.get("scope"), "https://graph.microsoft.com/.default");
  assertEquals(form.get("client_secret"), "FAKE-TEST-SECRET");
  assertEquals(calls[1].init.method, "GET");
  assertEquals(new URL(calls[1].url).searchParams.get("changeType"), "created");
  assertEquals(
    new Headers(calls[1].init.headers).get("prefer"),
    'IdType="ImmutableId"',
  );
  assert(calls.every((call) => call.init.redirect === "error"));
  await assertRejects(
    () => client.page({ ...target, tenantId: clientId }, null),
    MicrosoftGraphSyncError,
    "AUTH_FAILED",
  );
  assertEquals(calls.length, 2);
});

Deno.test("Graph continuation URLs are copied verbatim and a token is reused within an invocation", async () => {
  const { client, calls } = fixture([auth(), page(), page()]);
  await client.page(target, next);
  await client.page(target, delta);
  assertEquals(calls.slice(1).map((call) => call.url), [next.url, delta.url]);
});

Deno.test("Graph follows returned OData folder-key NEXT and DELTA links verbatim through the HTTP guard", async () => {
  const keyed = (url: string) =>
    url.replace(
      "/mailFolders/Folder%2B%2F%3D/",
      "/mailFolders('Folder%2B%2F%3D')/",
    );
  const keyedNext = { ...next, url: keyed(next.url) };
  const keyedDelta = { ...delta, url: keyed(delta.url) };
  const { client, calls } = fixture([
    auth(),
    Response.json({
      value: [{ id: "historical" }],
      "@odata.nextLink": keyedNext.url,
    }),
    Response.json({ value: [], "@odata.deltaLink": keyedDelta.url }),
    Response.json({ value: [], "@odata.deltaLink": keyedDelta.url }),
  ]);
  assertEquals((await client.page(target, null)).cursor, keyedNext);
  assertEquals((await client.page(target, keyedNext)).cursor, keyedDelta);
  assertEquals((await client.page(target, keyedDelta)).cursor, keyedDelta);
  assertEquals(calls.slice(2).map((call) => call.url), [
    keyedNext.url,
    keyedDelta.url,
  ]);
  assertEquals(calls.length, 4);
});

Deno.test("Attachment pagination accepts a matching OData folder key and refuses a different scoped resource before HTTP", async () => {
  const keyed = `${
    base.replace(
      "/mailFolders/Folder%2B%2F%3D/",
      "/mailFolders('Folder%2B%2F%3D')/",
    )
  }/M/attachments?$skiptoken=second`;
  const good = fixture([
    auth(),
    Response.json({ value: [], "@odata.nextLink": keyed }),
    Response.json({ value: [attachment()] }),
  ]);
  assertEquals((await good.client.attachments(target, "M")).length, 1);
  assertEquals(good.calls[2].url, keyed);
  for (
    const url of [
      keyed.replace(mailboxId, clientId),
      keyed.replace("Folder", "folder"),
      keyed.replace("/M/attachments", "/Other/attachments"),
    ]
  ) {
    const bad = fixture([
      auth(),
      Response.json({ value: [], "@odata.nextLink": url }),
    ]);
    await assertRejects(
      () => bad.client.attachments(target, "M"),
      MicrosoftGraphSyncError,
    );
    assertEquals(bad.calls.length, 2);
  }
});

Deno.test("Graph refreshes a 401 once and never returns a provider error body", async () => {
  const { client, calls } = fixture([
    auth(),
    new Response("sensitive provider diagnostic", { status: 401 }),
    auth(),
    new Response("another sensitive diagnostic", { status: 401 }),
  ]);
  const error = await assertRejects(
    () => client.page(target, next),
    MicrosoftGraphSyncError,
    "AUTH_FAILED",
  );
  assertEquals(error.message, "AUTH_FAILED");
  assertEquals(calls.length, 4);
});

Deno.test("Graph refreshes an expired cached application token", async () => {
  let current = 0;
  const { client, calls } = fixture([auth(), page(), auth(), page()], {
    now: () => current,
  });
  await client.page(target, null);
  current = 3_601_000;
  await client.page(target, delta);
  assertEquals(calls.filter((call) => call.init.method === "POST").length, 2);
});

Deno.test("Graph refuses unsafe delta links before sending application credentials", async () => {
  for (
    const url of [
      next.url.replace("graph.microsoft.com", "evil.example"),
      next.url.replace(mailboxId, clientId),
      next.url + "#fragment",
      next.url.replace("Folder%2B%2F%3D", "AnotherFolder"),
    ]
  ) {
    const { client, calls } = fixture([]);
    await assertRejects(() => client.page(target, { kind: "NEXT", url }));
    assertEquals(calls.length, 0);
  }
});

Deno.test("Graph rejects malformed delta responses before any message can be retained", async () => {
  const cases = [
    { value: [] },
    { value: [], "@odata.nextLink": next.url, "@odata.deltaLink": delta.url },
    { value: [{ id: "" }], "@odata.deltaLink": delta.url },
    { value: [{ id: "M", "@removed": true }], "@odata.deltaLink": delta.url },
    {
      value: [{ id: "M", "@removed": { reason: "unknown" } }],
      "@odata.deltaLink": delta.url,
    },
    { value: [], "@odata.deltaLink": delta.url.replace(mailboxId, clientId) },
    { value: [], "@odata.nextLink": next.url },
  ];
  for (const value of cases) {
    const { client } = fixture([auth(), Response.json(value)]);
    await assertRejects(() => client.page(target, next));
  }
});

Deno.test("Graph classifies throttling and preserves Retry-After without retrying immediately", async () => {
  for (
    const [header, expected] of [["120", 120], [
      "Thu, 01 Jan 1970 00:02:00 GMT",
      120,
    ], ["invalid", 60]] as const
  ) {
    const { client, calls } = fixture([
      auth(),
      new Response("do-not-retain", {
        status: 429,
        headers: { "Retry-After": header },
      }),
    ], { now: () => 0 });
    const error = await assertRejects(
      () => client.page(target, next),
      MicrosoftGraphSyncError,
      "GRAPH_THROTTLED",
    );
    assertEquals(
      (error as MicrosoftGraphSyncError).retryAfterSeconds,
      expected,
    );
    assertEquals(calls.length, 2);
  }
});

Deno.test("Graph does not follow cursor-expiry reset locations or reset the cursor", async () => {
  for (
    const response of [
      new Response(null, {
        status: 410,
        headers: { Location: `${base}/delta` },
      }),
      Response.json({
        error: { code: "syncStateNotFound", message: "raw private data" },
      }, { status: 404 }),
    ]
  ) {
    const { client, calls } = fixture([auth(), response]);
    await assertRejects(
      () => client.page(target, delta),
      MicrosoftGraphSyncError,
      "CURSOR_EXPIRED",
    );
    assertEquals(calls.length, 2);
  }
});

Deno.test("Graph maps forbidden, unavailable, missing folders and redirects to sanitized errors", async () => {
  for (
    const [status, expected] of [
      [403, "FORBIDDEN"],
      [503, "GRAPH_UNAVAILABLE"],
      [404, "FOLDER_NOT_FOUND"],
      [302, "SYNC_ERROR"],
    ] as const
  ) {
    const { client } = fixture([
      auth(),
      new Response(null, {
        status,
        headers: { Location: "https://evil.example" },
      }),
    ]);
    await assertRejects(
      () => client.page(target, null),
      MicrosoftGraphSyncError,
      expected,
    );
  }
});

Deno.test("Graph failures log the step, status and Microsoft codes without URLs, tokens or messages", async () => {
  const logged: GraphFailureDiagnostic[] = [];
  const diagnose = (entry: GraphFailureDiagnostic) => logged.push(entry);
  // Sign-in with Microsoft is unavailable.
  const signIn = fixture([
    Response.json({
      error: "temporarily_unavailable",
      error_description: "AADSTS90033: raw private data",
      error_codes: [90033],
    }, {
      status: 503,
      headers: { "x-ms-request-id": "req-1", "x-ms-ests-server": "2.1 - WUS2 ProdSlices" },
    }),
  ], { diagnose });
  await assertRejects(
    () => signIn.client.page(target, null),
    MicrosoftGraphSyncError,
    "GRAPH_UNAVAILABLE",
  );
  // The mailbox read is unavailable.
  const mailbox = fixture([
    auth(),
    Response.json({
      error: {
        code: "ErrorServerBusy",
        message: "raw private data",
        innerError: { code: "MailboxStoreUnavailable" },
      },
    }, {
      status: 503,
      headers: {
        "request-id": "req-2",
        "x-ms-ags-diagnostic": JSON.stringify({ ServerInfo: { DataCenter: "West US", RoleInstance: "X" } }),
      },
    }),
  ], { diagnose });
  await assertRejects(
    () => mailbox.client.page(target, delta),
    MicrosoftGraphSyncError,
    "GRAPH_UNAVAILABLE",
  );
  // No response arrives at all.
  const network = fixture([
    auth(),
    () => {
      throw new TypeError(`error sending request for url (${delta.url}): connection reset`);
    },
  ], { diagnose });
  await assertRejects(
    () => network.client.page(target, delta),
    MicrosoftGraphSyncError,
    "GRAPH_UNAVAILABLE",
  );
  assertEquals(logged, [
    {
      step: "token",
      status: 503,
      requestId: "req-1",
      server: "2.1 - WUS2 ProdSlices",
      providerCode: "temporarily_unavailable AADSTS90033",
    },
    {
      step: "delta",
      status: 503,
      requestId: "req-2",
      server: "West US",
      providerCode: "ErrorServerBusy/MailboxStoreUnavailable",
    },
    { step: "delta", network: "TypeError: error sending request for url ([url] connection reset" },
  ]);
  const text = JSON.stringify(logged);
  for (const hidden of ["raw private data", mailboxId, "FAKE-TEST-SECRET", "FAKE-ACCESS-TOKEN", "deltatoken"]) {
    assertEquals(text.includes(hidden), false);
  }
});

Deno.test("Graph deadline and body timeout bound requests including an unfinished stream", async () => {
  const expired = fixture([], { now: () => 100, deadline: 99 });
  await assertRejects(
    () => expired.client.page(target, null),
    MicrosoftGraphSyncError,
    "SYNC_INTERRUPTED",
  );
  assertEquals(expired.calls.length, 0);
  const pending = fixture([
    auth(),
    (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal!.addEventListener("abort", () =>
              controller.error(new DOMException("test abort", "AbortError")), {
              once: true,
            });
          },
        }),
      ),
  ], { requestTimeoutMs: 25 });
  await assertRejects(
    () => pending.client.page(target, null),
    MicrosoftGraphSyncError,
    "GRAPH_UNAVAILABLE",
  );
});

Deno.test("Graph lists attachments even without hasAttachments and checks pagination before credentials", async () => {
  const firstAttachmentPage =
    `${base}/M/attachments?$skiptoken=attachment-page-2`;
  const { client, calls } = fixture([
    auth(),
    Response.json({
      value: [attachment({ isInline: true })],
      "@odata.nextLink": firstAttachmentPage,
    }),
    Response.json({ value: [attachment({ id: "second" })] }),
  ]);
  const files = await client.attachments(target, "M");
  assertEquals(files.length, 2);
  assert(files[0].isInline);
  assertEquals(calls[2].url, firstAttachmentPage);
  const malicious = fixture([
    auth(),
    Response.json({
      value: [],
      "@odata.nextLink": firstAttachmentPage.replace(
        "graph.microsoft.com",
        "evil.example",
      ),
    }),
  ]);
  await assertRejects(
    () => malicious.client.attachments(target, "M"),
    MicrosoftGraphSyncError,
  );
  assertEquals(malicious.calls.length, 2);
});

Deno.test("Graph rejects repeated attachment pages and duplicate file identities", async () => {
  const tooMany = fixture([
    auth(),
    Response.json({
      value: Array.from(
        { length: 11 },
        (_, index) => attachment({ id: `File${index}` }),
      ),
    }),
  ]);
  await assertRejects(
    () => tooMany.client.attachments(target, "M"),
    EmailAttachmentValidationError,
    "10 files",
  );
  assertEquals(tooMany.calls.length, 2);
  const duplicate = fixture([
    auth(),
    Response.json({ value: [attachment(), attachment()] }),
  ]);
  await assertRejects(
    () => duplicate.client.attachments(target, "M"),
    EmailAttachmentValidationError,
    "metadata",
  );
  const initial =
    `${base}/M/attachments?$select=id,name,contentType,size,isInline`;
  const loop = fixture([
    auth(),
    Response.json({ value: [], "@odata.nextLink": initial }),
  ]);
  await assertRejects(
    () => loop.client.attachments(target, "M"),
    MicrosoftGraphSyncError,
  );
});

Deno.test("Graph metadata rejects invalid type, format, count and malformed sizes before downloads", () => {
  const badSets = [
    [attachment({ "@odata.type": "#microsoft.graph.itemAttachment" })],
    [attachment({ "@odata.type": "#microsoft.graph.referenceAttachment" })],
    [attachment({ name: "source.exe" })],
    [attachment({ contentType: "image/png" })],
    [attachment({ size: -1 })],
    [attachment({ size: 1.5 })],
    [attachment({ size: "8" })],
    [attachment({ size: Number.MAX_SAFE_INTEGER + 1 })],
    [attachment({ name: "bad\nname.pdf" })],
    [attachment({ isInline: "true" })],
    Array.from({ length: 11 }, (_, i) => attachment({ id: `A${i}` })),
  ];
  for (const files of badSets) {
    assertThrows(
      () => validateGraphAttachmentMetadata(files),
      EmailAttachmentValidationError,
    );
  }
});

Deno.test("Graph uses actual raw bytes despite smaller, larger or zero metadata sizes, preserving scoped IDs and shared validation", async () => {
  for (const size of [0, 1, 8, 1060, MAX_IMPORT_TOTAL_BYTES + 1]) {
    const metadata = validateGraphAttachmentMetadata([attachment({ size })]);
    const { client, calls } = fixture([
      auth(),
      new Response("%PDF-1.7", { headers: { "Content-Length": "8" } }),
    ]);
    const files = await client.files(target, "M+/=", metadata);
    assertEquals(files[0].file.size, 8);
    assertEquals(files[0].declaredSize, undefined);
    assertEquals((await validateEmailImportAttachments(files))[0].sizeBytes, 8);
    assertEquals(
      calls[1].url,
      `${base}/M%2B%2F%3D/attachments/File%2B%2F%3D/$value`,
    );
    assertEquals(
      new Headers(calls[1].init.headers).get("accept"),
      "application/octet-stream",
    );
  }
});

Deno.test("Graph accepts a completed download without Content-Length and still rejects empty bytes", async () => {
  const metadata = validateGraphAttachmentMetadata([attachment()]);
  const good = fixture([auth(), new Response("%PDF-1.7")]);
  assertEquals(
    (await good.client.files(target, "M", metadata))[0].file.size,
    8,
  );
  const empty = fixture([auth(), new Response(null)]);
  await assertRejects(
    () => empty.client.files(target, "M", metadata),
    EmailAttachmentValidationError,
    "is empty",
  );
});

Deno.test("Graph verifies unencoded Content-Length instead of the attachment metadata size", async () => {
  for (const length of ["7", "9", "-1", "8.5", "bad", "9007199254740992"]) {
    const { client } = fixture([
      auth(),
      new Response("%PDF-1.7", { headers: { "Content-Length": length } }),
    ]);
    const error = await assertRejects(
      () => client.files(target, "M", [attachment()]),
      EmailAttachmentValidationError,
    );
    assertEquals(
      (error as EmailAttachmentValidationError).code,
      "ATTACHMENT_SIZE",
    );
  }
});

Deno.test("Graph does not compare encoded transport length with decoded file length", async () => {
  const { client } = fixture([
    auth(),
    // Simulate fetch retaining encoded headers after decoding the body.
    new Response("%PDF-1.7", {
      headers: { "Content-Length": "28", "Content-Encoding": "gzip" },
    }),
  ]);
  const files = await client.files(target, "M", [attachment({ size: 1060 })]);
  assertEquals((await validateEmailImportAttachments(files))[0].sizeBytes, 8);
});

Deno.test("Graph rejects partial HTTP success and ranges even when their Content-Length matches", async () => {
  for (
    const response of [
      new Response("%PDF-1.7", {
        status: 206,
        headers: { "Content-Length": "8", "Content-Range": "bytes 0-7/100" },
      }),
      new Response("%PDF-1.7", {
        headers: { "Content-Length": "8", "Content-Range": "bytes 0-7/100" },
      }),
      new Response(null, { status: 204 }),
    ]
  ) {
    const { client } = fixture([auth(), response]);
    await assertRejects(
      () => client.files(target, "M", [attachment()]),
      EmailAttachmentValidationError,
      "complete",
    );
  }
});

Deno.test("Graph leaves interrupted downloads retryable instead of returning truncated files", async () => {
  const { client } = fixture([
    auth(),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("%PDF-1.7"));
        },
        pull(controller) {
          controller.error(new TypeError("private transport error"));
        },
      }),
    ),
  ]);
  await assertRejects(
    () => client.files(target, "M", [attachment()]),
    MicrosoftGraphSyncError,
    "GRAPH_UNAVAILABLE",
  );
});

Deno.test("Graph reproduces seven valid images whose reported sizes differ from raw downloads", async () => {
  const samples = [
    ["png", 3517, 3251, true],
    ["jpg", 37679, 37411, true],
    ["png", 494, 228, true],
    ["png", 494, 228, true],
    ["jpeg", 4059720, 3606310, false],
    ["jpeg", 2728028, 2467029, false],
    ["jpeg", 3100784, 2787248, false],
  ] as const;
  const metadata = samples.map(([extension, size, _actual, isInline], i) =>
    attachment({
      id: `F${i}`,
      name: `image${i}.${extension}`,
      contentType: "application/octet-stream",
      size,
      isInline,
    })
  );
  const replies = samples.map(([extension, _size, actual]) => {
    const bytes = new Uint8Array(actual);
    bytes.set(
      extension === "png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255],
    );
    return new Response(bytes, {
      headers: { "Content-Length": String(actual) },
    });
  });
  const { client } = fixture([auth(), ...replies]);
  const manifest = await validateEmailImportAttachments(
    await client.files(target, "M", validateGraphAttachmentMetadata(metadata)),
  );
  assertEquals(
    manifest.map((file) => file.sizeBytes),
    samples.map((s) => s[2]),
  );
  assertEquals(manifest.filter((file) => file.isInline).length, 4);
  assert(manifest.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});

Deno.test("Graph accepts exactly 10 MB per file and 50 MB actual total despite inflated metadata", async () => {
  const bytes = new Uint8Array(MAX_IMPORT_ATTACHMENT_BYTES);
  const metadata = Array.from({ length: 5 }, (_, i) =>
    attachment({
      id: `F${i}`,
      size: MAX_IMPORT_ATTACHMENT_BYTES + 1024,
    }));
  const { client } = fixture([
    auth(),
    ...metadata.map(() => new Response(bytes)),
  ]);
  const files = await client.files(
    target,
    "M",
    validateGraphAttachmentMetadata(metadata),
  );
  assertEquals(
    files.reduce((sum, file) => sum + file.file.size, 0),
    MAX_IMPORT_TOTAL_BYTES,
  );
});

Deno.test("Graph cancels a download exceeding the remaining 50 MB budget despite understated metadata", async () => {
  let cancelled = false;
  const bytes = new Uint8Array(9_000_000);
  const metadata = Array.from(
    { length: 6 },
    (_, i) => attachment({ id: `F${i}`, size: 1 }),
  );
  const { client, calls } = fixture([
    auth(),
    ...metadata.slice(0, 5).map(() => new Response(bytes)),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(5_000_001));
        },
        cancel() {
          cancelled = true;
        },
      }),
    ),
  ]);
  const error = await assertRejects(
    () => client.files(target, "M", metadata),
    EmailAttachmentValidationError,
    "50 MB",
  );
  assertEquals(
    (error as EmailAttachmentValidationError).code,
    "ATTACHMENT_TOTAL_SIZE",
  );
  assertEquals(
    new Headers(calls[6].init.headers).get("accept"),
    "application/octet-stream",
  );
  assert(cancelled);
});

Deno.test("Graph skips downloads for an email without attachments", async () => {
  const { client, calls } = fixture([]);
  assertEquals(await client.files(target, "M", []), []);
  assertEquals(calls.length, 0);
});

Deno.test("Graph cancels a stream that exceeds 10 MB without returning a partial file", async () => {
  let cancelled = false;
  const overflow = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMPORT_ATTACHMENT_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  const { client } = fixture([auth(), overflow]);
  await assertRejects(
    () =>
      client.files(
        target,
        "M",
        validateGraphAttachmentMetadata([attachment()]),
      ),
    EmailAttachmentValidationError,
    "10 MB",
  );
  assert(cancelled);
});

Deno.test("Graph will not read a message from a different folder or accept a different immutable ID", async () => {
  for (
    const value of [{ id: "M", parentFolderId: "other" }, {
      id: "other",
      parentFolderId: target.folderId,
    }]
  ) {
    const { client } = fixture([auth(), Response.json(value)]);
    await assertRejects(
      () => client.message(target, "M"),
      EmailAttachmentValidationError,
    );
  }
});

Deno.test("Graph source failures are recoverable problems while provider outages leave the cursor unchanged", async () => {
  const missing = fixture([
    auth(),
    Response.json({ error: { message: "private diagnostic" } }, {
      status: 404,
    }),
  ]);
  await assertRejects(
    () => missing.client.message(target, "M"),
    EmailAttachmentValidationError,
    "is unavailable",
  );
  const unavailable = fixture([auth(), new Response(null, { status: 503 })]);
  await assertRejects(
    () => unavailable.client.message(target, "M"),
    MicrosoftGraphSyncError,
    "GRAPH_UNAVAILABLE",
  );
});
