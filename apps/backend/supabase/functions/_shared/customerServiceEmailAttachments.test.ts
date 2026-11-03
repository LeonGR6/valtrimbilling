import { assertEquals, assertRejects } from "@std/assert";
import {
  EmailAttachmentValidationError,
  type EmailImportAttachment,
  type EmailImportFileManifest,
  type EmailImportSourcePort,
  type ImportSourceResult,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_TOTAL_BYTES,
  retainEmailImportSource,
  validateEmailImportAttachments,
} from "./customerServiceEmailAttachments.ts";

function attachment(
  id = "file-1",
  name = "order.pdf",
  type = "application/pdf",
  size = 24,
): EmailImportAttachment {
  const bytes = new Uint8Array(size);
  const signature = name.toLowerCase().endsWith(".png")
    ? [137, 80, 78, 71, 13, 10, 26, 10]
    : /\.jpe?g$/i.test(name)
    ? [255, 216, 255]
    : [...new TextEncoder().encode("%PDF-1.7")];
  bytes.set(signature.slice(0, size));
  return { id, file: new File([bytes], name, { type }) };
}

const source = {
  subject: "Work order",
  bodyText: "Original email",
  webLink: "https://outlook.office.com/mail/",
};

Deno.test("email contract uses decimal MB without changing the manual PDF module", () => {
  assertEquals(MAX_IMPORT_ATTACHMENT_BYTES, 10_000_000);
  assertEquals(MAX_IMPORT_TOTAL_BYTES, 50_000_000);
});

Deno.test("email without attachments is valid", async () => {
  assertEquals(await validateEmailImportAttachments([]), []);
});

for (
  const [name, type] of [
    ["ORDER.PDF", "application/pdf"],
    ["photo.jpg", "image/jpeg"],
    ["photo.JPEG", "image/jpeg"],
    ["photo.png", "image/png"],
    ["photo.png", "application/octet-stream"],
    ["photo.jpg", ""],
  ]
) {
  Deno.test(`validates format/signature ${name} (${type || "no MIME"})`, async () => {
    const [file] = await validateEmailImportAttachments([
      attachment("f", name, type),
    ]);
    assertEquals(file.originalFilename, name);
    assertEquals(file.sha256.length, 64);
  });
}

Deno.test("retains inline/content identity and sorts opaque IDs without collapsing case", async () => {
  const inline = {
    ...attachment("a", "inline.png", "image/png"),
    isInline: true,
    contentId: "logo@id",
  };
  const manifest = await validateEmailImportAttachments([
    inline,
    attachment("A"),
  ]);
  assertEquals(manifest.map((file) => file.attachmentId), ["A", "a"]);
  assertEquals(manifest[1].isInline, true);
  assertEquals(manifest[1].contentId, "logo@id");
});

Deno.test("exactly ten attachments, including inline images, are accepted", async () => {
  assertEquals(
    (await validateEmailImportAttachments(
      Array.from({ length: 10 }, (_, i) => ({
        ...attachment(String(i)),
        isInline: true,
      })),
    )).length,
    10,
  );
});

Deno.test("exactly 10 MB per file and 50 MB total are accepted", async () => {
  const files = Array.from(
    { length: 5 },
    (_, i) =>
      attachment(
        String(i),
        "order.pdf",
        "application/pdf",
        MAX_IMPORT_ATTACHMENT_BYTES,
      ),
  );
  assertEquals(
    (await validateEmailImportAttachments(files)).reduce(
      (sum, file) => sum + file.sizeBytes,
      0,
    ),
    MAX_IMPORT_TOTAL_BYTES,
  );
});

const invalidCases: Array<[string, () => EmailImportAttachment[], string]> = [
  [
    "eleven files including inline",
    () =>
      Array.from(
        { length: 11 },
        (_, i) => ({ ...attachment(String(i)), isInline: true }),
      ),
    "ATTACHMENT_COUNT",
  ],
  [
    "over 10 MB",
    () => [
      attachment(
        "a",
        "order.pdf",
        "application/pdf",
        MAX_IMPORT_ATTACHMENT_BYTES + 1,
      ),
    ],
    "ATTACHMENT_SIZE",
  ],
  [
    "over 50 MB",
    () => [
      ...Array.from({ length: 5 }, (_, i) =>
        attachment(
          String(i),
          "order.pdf",
          "application/pdf",
          MAX_IMPORT_ATTACHMENT_BYTES,
        )),
      attachment("extra"),
    ],
    "ATTACHMENT_TOTAL_SIZE",
  ],
  [
    "empty file",
    () => [attachment("a", "order.pdf", "application/pdf", 0)],
    "ATTACHMENT_SIZE",
  ],
  [
    "unsupported extension",
    () => [attachment("a", "photo.webp", "image/webp")],
    "ATTACHMENT_FORMAT",
  ],
  [
    "conflicting MIME",
    () => [attachment("a", "order.pdf", "image/png")],
    "ATTACHMENT_FORMAT",
  ],
  [
    "renamed executable",
    () => [{
      id: "a",
      file: new File(["MZ-not-pdf"], "order.pdf", { type: "application/pdf" }),
    }],
    "ATTACHMENT_SIGNATURE",
  ],
  [
    "duplicate attachment identity",
    () => [attachment("a"), attachment("a")],
    "ATTACHMENT_METADATA",
  ],
  ["blank attachment identity", () => [attachment(" ")], "ATTACHMENT_METADATA"],
  [
    "long filename",
    () => [attachment("a", `${"a".repeat(252)}.pdf`)],
    "ATTACHMENT_METADATA",
  ],
  [
    "filename control",
    () => [attachment("a", "bad\nname.pdf")],
    "ATTACHMENT_METADATA",
  ],
  [
    "reference attachment",
    () => [{ ...attachment(), attachmentType: "reference" }],
    "ATTACHMENT_FORMAT",
  ],
  [
    "embedded message",
    () => [{ ...attachment(), attachmentType: "item" }],
    "ATTACHMENT_FORMAT",
  ],
  [
    "provider size mismatch",
    () => [{ ...attachment(), declaredSize: 999 }],
    "ATTACHMENT_SIZE",
  ],
];
for (const [name, files, code] of invalidCases) {
  Deno.test(`rejects ${name}`, async () => {
    const error = await assertRejects(
      () => validateEmailImportAttachments(files()),
      EmailAttachmentValidationError,
    );
    assertEquals(error.code, code);
  });
}

function fixture() {
  const objects = new Map<string, Blob>();
  const state = {
    manifest: null as EmailImportFileManifest[] | null,
    available: false,
    rejected: false,
    prepares: 0,
    uploads: 0,
    downloads: 0,
    commits: 0,
    failures: 0,
    lastError: "",
  };
  const result = (): ImportSourceResult => ({
    importId: "import-id",
    requestId: null,
    sourceStatus: state.available
      ? "AVAILABLE"
      : state.rejected
      ? "REJECTED"
      : "UPLOADING",
    status: state.rejected || state.failures ? "NEEDS_ATTENTION" : "PENDING",
    attachments: state.manifest?.map((file, i) => ({
      ...file,
      objectPath: `imports/import-id/${i}-${file.sha256}`,
    })),
  });
  const port: EmailImportSourcePort = {
    prepare: (_source, manifest) => {
      state.prepares++;
      if (state.manifest) assertEquals(manifest, state.manifest);
      state.manifest = manifest;
      return Promise.resolve(result());
    },
    reject: (code, message) => {
      state.rejected = true;
      state.lastError = `${code}: ${message}`;
      return Promise.resolve(result());
    },
    upload: (object, file) => {
      state.uploads++;
      if (objects.has(object.objectPath)) {
        return Promise.reject(new Error("Already exists"));
      }
      objects.set(object.objectPath, file);
      return Promise.resolve();
    },
    download: (object) => {
      state.downloads++;
      const blob = objects.get(object.objectPath);
      return blob
        ? Promise.resolve(blob)
        : Promise.reject(new Error("Missing object"));
    },
    finalize: () => {
      if (!state.available) state.commits++;
      state.available = true;
      state.failures = 0;
      return Promise.resolve(result());
    },
    fail: (message) => {
      if (!state.available) {
        state.failures++;
        state.lastError = message;
      }
      return Promise.resolve(result());
    },
  };
  return { state, port, objects };
}

for (const [name, files] of invalidCases) {
  Deno.test(`whole email rejected before any source/file write: ${name}`, async () => {
    const f = fixture();
    const result = await retainEmailImportSource({
      source,
      attachments: files(),
      port: f.port,
    });
    assertEquals(result.sourceStatus, "REJECTED");
    assertEquals(result.requestId, null);
    assertEquals(f.state.prepares, 0);
    assertEquals(f.state.uploads, 0);
    assertEquals(f.state.commits, 0);
    assertEquals(f.objects.size, 0);
  });
}

Deno.test("bad second attachment prevents storing the otherwise valid first file", async () => {
  const f = fixture();
  await retainEmailImportSource({
    source,
    attachments: [attachment(), {
      id: "bad",
      file: new File(["not png"], "bad.png", { type: "image/png" }),
    }],
    port: f.port,
  });
  assertEquals(f.state.uploads, 0);
  assertEquals(f.state.prepares, 0);
  assertEquals(f.state.lastError.startsWith("ATTACHMENT_SIGNATURE"), true);
});

Deno.test("retains all validated files before publishing the source, never creating a request", async () => {
  const f = fixture();
  const result = await retainEmailImportSource({
    source,
    attachments: [
      attachment("pdf"),
      attachment("image", "photo.png", "image/png"),
    ],
    port: f.port,
  });
  assertEquals(result.sourceStatus, "AVAILABLE");
  assertEquals(result.requestId, null);
  assertEquals(f.objects.size, 2);
  assertEquals(f.state.commits, 1);
});

Deno.test("no-attachment email can publish its body without uploading files", async () => {
  const f = fixture();
  const result = await retainEmailImportSource({
    source,
    attachments: [],
    port: f.port,
  });
  assertEquals(result.sourceStatus, "AVAILABLE");
  assertEquals(f.state.uploads, 0);
  assertEquals(f.state.commits, 1);
});

Deno.test("lost upload response is recovered by matching size and SHA-256", async () => {
  const f = fixture();
  const result = await retainEmailImportSource({
    source,
    attachments: [attachment()],
    port: {
      ...f.port,
      upload: async (object, file) => {
        await f.port.upload(object, file);
        throw new Error("Response lost");
      },
    },
  });
  assertEquals(result.sourceStatus, "AVAILABLE");
  assertEquals(f.state.downloads, 1);
  assertEquals(f.state.commits, 1);
});

Deno.test("interrupted valid set is a problem without published references and recovers on the same manifest", async () => {
  const f = fixture();
  const attachments = [
    attachment("a"),
    attachment("b", "photo.jpg", "image/jpeg"),
  ];
  let calls = 0;
  const failure = await retainEmailImportSource({
    source,
    attachments,
    port: {
      ...f.port,
      upload: (object, file) =>
        ++calls === 2
          ? Promise.reject(new Error("Offline"))
          : f.port.upload(object, file),
    },
  });
  assertEquals(failure.status, "NEEDS_ATTENTION");
  assertEquals(failure.sourceStatus, "UPLOADING");
  assertEquals(failure.requestId, null);
  assertEquals(f.state.commits, 0);
  assertEquals(f.objects.size, 1);
  const success = await retainEmailImportSource({
    source,
    attachments: [...attachments].reverse(),
    port: f.port,
  });
  assertEquals(success.sourceStatus, "AVAILABLE");
  assertEquals(f.objects.size, 2);
  assertEquals(f.state.commits, 1);
});

Deno.test("different existing bytes cannot be replaced or published", async () => {
  const f = fixture();
  const files = [attachment()];
  const [manifest] = await validateEmailImportAttachments(files);
  const path = `imports/import-id/0-${manifest.sha256}`;
  const previous = new Blob([new Uint8Array(files[0].file.size)]);
  f.objects.set(path, previous);
  const result = await retainEmailImportSource({
    source,
    attachments: files,
    port: f.port,
  });
  assertEquals(result.status, "NEEDS_ATTENTION");
  assertEquals(f.state.commits, 0);
  assertEquals(f.objects.get(path), previous);
  assertEquals(f.state.lastError.includes("requiere revisión manual"), true);
});

Deno.test("lost finalize response does not degrade or delete the available source", async () => {
  const f = fixture();
  const result = await retainEmailImportSource({
    source,
    attachments: [attachment()],
    port: {
      ...f.port,
      finalize: async () => {
        await f.port.finalize();
        throw new Error("Response lost after commit");
      },
    },
  });
  assertEquals(result.sourceStatus, "AVAILABLE");
  assertEquals(f.objects.size, 1);
  assertEquals(f.state.failures, 0);
  await retainEmailImportSource({
    source,
    attachments: [attachment()],
    port: f.port,
  });
  assertEquals(f.state.uploads, 1);
  assertEquals(f.state.commits, 1);
});

Deno.test("unconfirmed finalize failure is visible and the retry can finalize retained objects", async () => {
  const f = fixture();
  const attachments = [attachment()];
  const problem = await retainEmailImportSource({
    source,
    attachments,
    port: {
      ...f.port,
      finalize: () => Promise.reject(new Error("Database offline")),
    },
  });
  assertEquals(problem.status, "NEEDS_ATTENTION");
  assertEquals(f.state.commits, 0);
  assertEquals(f.objects.size, 1);
  const success = await retainEmailImportSource({
    source,
    attachments,
    port: f.port,
  });
  assertEquals(success.sourceStatus, "AVAILABLE");
  assertEquals(f.state.commits, 1);
});

Deno.test("operational error record does not leak SDK URLs or secrets", async () => {
  const f = fixture();
  await retainEmailImportSource({
    source,
    attachments: [attachment()],
    port: {
      ...f.port,
      upload: () =>
        Promise.reject(new Error("https://private/object?token=secret")),
    },
  });
  assertEquals(f.state.lastError.includes("secret"), false);
  assertEquals(f.state.lastError.includes("http"), false);
});

Deno.test("concurrent identical uploads never overwrite objects or publish twice", async () => {
  const f = fixture();
  const input = { source, attachments: [attachment()], port: f.port };
  const results = await Promise.all([
    retainEmailImportSource(input),
    retainEmailImportSource(input),
  ]);
  assertEquals(
    results.every((result) => result.sourceStatus === "AVAILABLE"),
    true,
  );
  assertEquals(f.objects.size, 1);
  assertEquals(f.state.commits, 1);
});

Deno.test("error recording failure is not misreported as a recorded import problem", async () => {
  const f = fixture();
  await assertRejects(
    () =>
      retainEmailImportSource({
        source,
        attachments: [attachment("bad", "bad.webp", "image/webp")],
        port: {
          ...f.port,
          reject: () => Promise.reject(new Error("Database offline")),
        },
      }),
    Error,
    "Database offline",
  );
  assertEquals(f.state.prepares, 0);
});
