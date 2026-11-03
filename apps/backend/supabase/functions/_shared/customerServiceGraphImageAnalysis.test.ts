import { assertEquals, assertRejects } from "@std/assert";
import {
  analyzeCustomerServiceEmail,
  type AnalyzedImportSource,
} from "./customerServiceEmailAnalysis.ts";
import {
  graphAnalysisFixture,
  importFacts,
  importPdf,
  importPng,
} from "./customerServiceEmailTestFixtures.ts";
import { EmailImportContinuation } from "./customerServiceEmailRuntime.ts";
import { MicrosoftGraphSyncError } from "./customerServiceMicrosoftGraph.ts";
import { containsEmailBinary } from "./customerServiceEmailSourcePolicy.ts";

Deno.test("V2 image text and supported facts survive with no stored-file references or binary", async () => {
  const f = await graphAnalysisFixture();
  f.extractor.image = () =>
    Promise.resolve({
      model: "vision",
      structuredData: importFacts(),
      text: "Adjust entry door",
      usageInfo: {
        total_tokens: 12,
        contentBytes: "forbidden",
        echo: importPng(),
      },
    });
  const report = await analyzeCustomerServiceEmail(f);
  const image = report.sources.find((source) => source.kind === "IMAGE")!;
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(image.text, "Adjust entry door");
  assertEquals(image.fileId, null);
  assertEquals(image.usageInfo, { total_tokens: 12 });
  assertEquals(f.calls.download, 0);
  assertEquals(f.imageReads, ["file-1"]);
  assertEquals(containsEmailBinary(report), false);
  assertEquals(
    /objectPath|bucketId|contentBytes|data:image/.test(JSON.stringify(report)),
    false,
  );
});

Deno.test("V2 photo without text is analyzed without inventing text or work", async () => {
  const f = await graphAnalysisFixture();
  f.extractor.image = () =>
    Promise.resolve({
      model: "vision",
      text: null,
      structuredData: importFacts(null, null),
      usageInfo: null,
    });
  const report = await analyzeCustomerServiceEmail(f);
  assertEquals(report.outcome, "READY_FOR_INTAKE"); // The email supplies the minimum.
  const image = report.sources.find((source) => source.kind === "IMAGE")!;
  assertEquals(image.status, "ANALYZED");
  assertEquals(image.text, null);
  assertEquals(image.structuredData?.serviceItems, []);
});

Deno.test("V2 email without files uses neither Graph nor Storage", async () => {
  const f = await graphAnalysisFixture([]);
  const report = await analyzeCustomerServiceEmail(f);
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(f.imageReads, []);
  assertEquals(f.calls.download, 0);
});

Deno.test("V2 mixed PDF and inline image keep independent storage and Graph sources", async () => {
  const f = await graphAnalysisFixture([await importPdf(), importPng()]);
  f.receipt.sourceManifest[1].isInline = true;
  const report = await analyzeCustomerServiceEmail(f);
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(f.calls.pdf, 1);
  assertEquals(f.calls.image, 1);
  assertEquals(f.calls.download, 1);
  assertEquals(f.imageReads, ["file-2"]);
  assertEquals(
    report.sources.filter((source) => source.kind === "IMAGE").map((source) =>
      source.fileId
    ),
    [null],
  );
});

Deno.test("V2 retry downloads only failed images and preserves successful image and email analyses", async () => {
  const f = await graphAnalysisFixture([importPng(), importPng()]);
  const checkpoint: AnalyzedImportSource[] = [];
  const first = await analyzeCustomerServiceEmail({
    ...f,
    onSource: (source) => {
      checkpoint.push(structuredClone(source));
      return Promise.resolve();
    },
    downloadImage: (file) =>
      file.attachmentId === "file-2"
        ? Promise.reject(new MicrosoftGraphSyncError("GRAPH_THROTTLED", 1234))
        : f.downloadImage(file),
  });
  assertEquals(first.outcome, "NEEDS_ATTENTION");
  assertEquals(first.intakePayload, null);
  assertEquals(checkpoint.at(-1)?.error?.retryAfterSeconds, 1234);
  assertEquals(checkpoint.at(-1)?.error?.retryable, true);
  const second = await analyzeCustomerServiceEmail({ ...f, checkpoint });
  assertEquals(second.outcome, "READY_FOR_INTAKE");
  assertEquals(f.calls.text.length, 1);
  assertEquals(f.calls.image, 2);
  assertEquals(f.imageReads, ["file-1", "file-2"]);
  assertEquals(containsEmailBinary(checkpoint), false);
});

Deno.test("V2 continuation reuses complete image checkpoints without Graph access or credentials", async () => {
  const f = await graphAnalysisFixture();
  const first = await analyzeCustomerServiceEmail(f);
  const second = await analyzeCustomerServiceEmail({
    ...f,
    checkpoint: first.sources,
    downloadImage: () => {
      throw new Error("Graph must not be needed");
    },
  });
  assertEquals(second.outcome, "READY_FOR_INTAKE");
  assertEquals(f.calls.image, 1);
  assertEquals(f.calls.text.length, 1);
  const pending = await graphAnalysisFixture();
  await assertRejects(
    () =>
      analyzeCustomerServiceEmail({
        ...pending,
        downloadImage: () => Promise.reject(new EmailImportContinuation(60)),
      }),
    EmailImportContinuation,
  );
});

Deno.test("V2 changed or unavailable images block intake without being silently replaced", async () => {
  for (const changed of [false, true]) {
    const f = await graphAnalysisFixture();
    const bytes = new Uint8Array(await importPng().arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    const report = await analyzeCustomerServiceEmail({
      ...f,
      downloadImage: () =>
        changed
          ? Promise.resolve(new Blob([bytes]))
          : Promise.reject(new Error("signed URL secret body")),
    });
    assertEquals(report.outcome, "NEEDS_ATTENTION");
    assertEquals(report.intakePayload, null);
    assertEquals(f.calls.image, 0);
    assertEquals(report.sources.at(-1)?.error?.code, "SOURCE_UNAVAILABLE");
    assertEquals(JSON.stringify(report).includes("secret"), false);
  }
});

Deno.test("V2 provider image binary echoed as text or facts cannot reach a checkpoint", async () => {
  const encoded = `data:image/png;base64,${btoa("not retained")}`;
  for (const field of ["text", "facts"]) {
    const f = await graphAnalysisFixture();
    f.extractor.image = () =>
      Promise.resolve({
        model: "vision",
        usageInfo: null,
        text: field === "text" ? encoded : null,
        structuredData: importFacts(
          null,
          field === "facts" ? encoded : "Adjust door",
        ),
      });
    const report = await analyzeCustomerServiceEmail({
      ...f,
      onSource: (source) => {
        assertEquals(containsEmailBinary(source), false);
        return Promise.resolve();
      },
    });
    assertEquals(report.outcome, "NEEDS_ATTENTION");
    assertEquals(containsEmailBinary(report), false);
  }
});

Deno.test("V2 rejects stored-image impersonation, omitted PDFs and excessive sets before any inference", async () => {
  for (const corrupt of ["path", "pdf", "count", "size", "total"]) {
    const f = await graphAnalysisFixture(
      corrupt === "pdf" ? [await importPdf(), importPng()] : [importPng()],
    );
    if (corrupt === "path") {
      f.receipt.sourceManifest[0].objectPath = "must-not-exist";
    }
    if (corrupt === "pdf") f.receipt.attachmentRefs = [];
    if (corrupt === "count") {
      f.receipt.sourceManifest = Array.from(
        { length: 11 },
        (_, n) => ({ ...f.receipt.sourceManifest[0], attachmentId: `I${n}` }),
      );
    }
    if (corrupt === "size") f.receipt.sourceManifest[0].sizeBytes = 10_000_001;
    if (corrupt === "total") {
      f.receipt.sourceManifest = Array.from(
        { length: 6 },
        (_, n) => ({
          ...f.receipt.sourceManifest[0],
          attachmentId: `I${n}`,
          sizeBytes: 10_000_000,
        }),
      );
    }
    await assertRejects(() => analyzeCustomerServiceEmail(f));
    assertEquals(f.calls.text.length + f.calls.image + f.calls.download, 0);
    assertEquals(f.imageReads, []);
  }
});
