import { assertEquals, assertRejects } from "@std/assert";
import { analyzeCustomerServiceEmail } from "./customerServiceEmailAnalysis.ts";
import { MistralOcrError } from "./mistralOcr.ts";
import {
  analysisFixture,
  importFacts,
  importPdf,
  importPng,
} from "./customerServiceEmailTestFixtures.ts";

Deno.test("source failures retain safe provider status without raw diagnostics or credentials", async () => {
  const fixture = await analysisFixture();
  fixture.extractor.text = () => {
    throw new MistralOcrError(
      "MUST_NOT_PERSIST_PROVIDER_SECRET_OR_SOURCE",
      401,
    );
  };
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.sources[0].error?.providerStatus, 401);
  assertEquals(JSON.stringify(report).includes("MUST_NOT_PERSIST"), false);
});

Deno.test("email-only import produces a retained-data proposal without any file download", async () => {
  const fixture = await analysisFixture();
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(report.sources.length, 1);
  assertEquals(fixture.calls.download, 0);
  assertEquals(report.intakePayload?.contacts[0].name, "Elena Rivera");
});
Deno.test("email checkpoints compare offsets independently of PostgreSQL jsonb key order", async () => {
  const fixture = await analysisFixture();
  const previous = await analyzeCustomerServiceEmail(fixture);
  const checkpoint = structuredClone(previous.sources);
  const part = checkpoint[0].part!;
  checkpoint[0].part = { end: part.end, start: part.start };
  const resumed = await analyzeCustomerServiceEmail({ ...fixture, checkpoint });
  assertEquals(resumed.outcome, "READY_FOR_INTAKE");
  assertEquals(fixture.calls.text.length, 1);
  assertEquals(
    resumed.sources[0].structuredData,
    previous.sources[0].structuredData,
  );
});
Deno.test("changed email offsets or text cannot reuse a successful checkpoint", async () => {
  for (const changed of ["start", "end", "text", "extra"] as const) {
    const fixture = await analysisFixture();
    const previous = await analyzeCustomerServiceEmail(fixture);
    const checkpoint = structuredClone(previous.sources);
    if (changed === "text") checkpoint[0].text += " changed";
    else if (changed === "extra") {
      Object.assign(checkpoint[0].part!, { extra: 1 });
    } else checkpoint[0].part![changed] += 1;
    await analyzeCustomerServiceEmail({ ...fixture, checkpoint });
    assertEquals(fixture.calls.text.length, 2);
  }
});
Deno.test("PDF-only import analyzes the complete document", async () => {
  const fixture = await analysisFixture([await importPdf()]);
  fixture.receipt.sourcePayload = {};
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(fixture.calls.pdf, 1);
  assertEquals(report.sources[0].pages.length, 1);
  assertEquals(report.sources[0].fileId, 1);
});
Deno.test("image-only import calls vision, not the text/PDF extractor", async () => {
  const fixture = await analysisFixture([importPng()]);
  fixture.receipt.sourcePayload = {};
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(fixture.calls.image, 1);
  assertEquals(fixture.calls.pdf, 0);
  assertEquals(fixture.calls.text.length, 0);
});
Deno.test("mixed email/PDF/image combines facts and preserves each original identity and model", async () => {
  const fixture = await analysisFixture([await importPdf(), importPng()]);
  fixture.extractor.text = () =>
    Promise.resolve({
      model: "mail-test",
      structuredData: importFacts("Elena Rivera", null),
      usageInfo: null,
    });
  fixture.extractor.pdf = () =>
    Promise.resolve({
      model: "pdf-test",
      structuredData: importFacts(null, "Adjust entry door"),
      usageInfo: null,
      text: "Door work",
      pages: [{
        index: 0,
        markdown: "Door work",
        averageConfidence: 1,
        minimumConfidence: 1,
      }],
    });
  fixture.extractor.image = () =>
    Promise.resolve({
      model: "photo-test",
      structuredData: importFacts(null, "Visible frame gap"),
      usageInfo: null,
    });
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(report.intakePayload?.items.length, 2);
  assertEquals(report.sources.map((source) => source.model), [
    "mail-test",
    "pdf-test",
    "photo-test",
  ]);
  assertEquals(report.sources.filter((source) => source.sha256).length, 2);
  assertEquals(
    report.provenance["contacts.0.name"][0].sourceId.startsWith("email:"),
    true,
  );
});
Deno.test("fillable PDF values are analyzed even when the OCR sees only a blank appearance", async () => {
  const fixture = await analysisFixture([await importPdf({ form: true })]);
  fixture.receipt.sourcePayload = {};
  fixture.extractor.pdf = () =>
    Promise.resolve({
      model: "ocr",
      structuredData: importFacts(null, null),
      usageInfo: null,
      text: "Blank form",
      pages: [{
        index: 0,
        markdown: "Blank form",
        averageConfidence: 1,
        minimumConfidence: 1,
      }],
    });
  fixture.extractor.text = (text, sourceKind?: "EMAIL" | "PDF_FIELDS") => {
    assertEquals(text.includes('"value":"Elena Rivera"'), true);
    assertEquals(sourceKind, "PDF_FIELDS");
    return Promise.resolve({
      model: "fields",
      structuredData: importFacts(),
      usageInfo: null,
    });
  };
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(report.sources.map((source) => source.kind), [
    "PDF",
    "PDF_FIELDS",
  ]);
  assertEquals(report.sources[0].formFields.length, 4);
});
Deno.test("long body is fully analyzed rather than rejected by the manual 50k text limit", async () => {
  const fixture = await analysisFixture();
  fixture.receipt.sourcePayload = { bodyText: "Door work. ".repeat(10_000) };
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(fixture.calls.text.length > 1, true);
  assertEquals(
    fixture.calls.text.join(""),
    String(fixture.receipt.sourcePayload.bodyText).trim(),
  );
  assertEquals(report.outcome, "READY_FOR_INTAKE");
});
Deno.test("missing optional fields do not turn a valid minimum into an extraction error", async () => {
  const report = await analyzeCustomerServiceEmail(await analysisFixture());
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(report.intakePayload?.property.jobId, null);
  assertEquals(report.intakePayload?.request.reportedOn, null);
});
Deno.test("missing minimum retains facts and a problem without a fabricated request proposal", async () => {
  const fixture = await analysisFixture();
  fixture.extractor.text = () =>
    Promise.resolve({
      model: "text",
      structuredData: importFacts(null),
      usageInfo: null,
    });
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.outcome, "NEEDS_ATTENTION");
  assertEquals(report.intakePayload, null);
  assertEquals(report.structuredData.serviceItems.length, 1);
});
Deno.test("one failed image blocks automatic intake even when email already supplies the minimum", async () => {
  const fixture = await analysisFixture([importPng()]);
  fixture.extractor.image = () =>
    Promise.reject(new Error("Provider offline; signed-url=secret"));
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.outcome, "NEEDS_ATTENTION");
  assertEquals(report.intakePayload, null);
  assertEquals(report.sources[1].status, "FAILED");
  assertEquals(JSON.stringify(report).includes("signed-url=secret"), false);
});
Deno.test("missing original file is retained as a source error, never silently omitted", async () => {
  const fixture = await analysisFixture([importPng()]);
  fixture.download = () => Promise.reject(new Error("Missing"));
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.sources[1].error?.code, "SOURCE_UNAVAILABLE");
  assertEquals(report.intakePayload, null);
  assertEquals(fixture.calls.image, 0);
});
Deno.test("same-size different bytes cannot be sent as the registered original", async () => {
  const fixture = await analysisFixture([importPng()]);
  const bad = new Uint8Array(importPng().size);
  bad.set([137, 80, 78, 71, 13, 10, 26, 10]);
  fixture.download = () =>
    Promise.resolve(new File([bad], "door.png", { type: "image/png" }));
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.sources[1].error?.code, "SOURCE_UNAVAILABLE");
  assertEquals(fixture.calls.image, 0);
});
Deno.test("incomplete OCR page coverage does not count as a complete PDF analysis", async () => {
  const fixture = await analysisFixture([await importPdf({ pages: 2 })]);
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.sources[1].error?.code, "SOURCE_UNREADABLE");
  assertEquals(report.intakePayload, null);
});
Deno.test("malformed structured data cannot inject workflow fields", async () => {
  const fixture = await analysisFixture();
  fixture.extractor.text = () =>
    Promise.resolve({
      model: "invalid",
      structuredData: { ...importFacts(), workflowStage: "READY_TO_PROPOSE" },
      usageInfo: null,
    });
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.outcome, "NEEDS_ATTENTION");
  assertEquals(report.intakePayload, null);
  assertEquals(report.sources[0].structuredData, null);
});
Deno.test("PDF facts cannot claim evidence on a page that does not exist", async () => {
  const fixture = await analysisFixture([await importPdf()]);
  const extractPdf = fixture.extractor.pdf;
  fixture.extractor.pdf = async (file) => {
    const result = await extractPdf(file);
    result.structuredData.contacts[0].sourcePage = 2;
    return result;
  };
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.sources[1].error?.code, "SOURCE_UNREADABLE");
  assertEquals(report.sources[1].structuredData, null);
  assertEquals(report.intakePayload, null);
});
Deno.test("rejected or incomplete originals never reach a model", async () => {
  const fixture = await analysisFixture();
  fixture.receipt.sourceStatus = "REJECTED";
  await assertRejects(
    () => analyzeCustomerServiceEmail(fixture),
    Error,
    "AVAILABLE",
  );
  assertEquals(fixture.calls.text.length, 0);
});
Deno.test("published attachment subset cannot masquerade as the complete source", async () => {
  const fixture = await analysisFixture([importPng()]);
  fixture.receipt.attachmentRefs = [];
  await assertRejects(
    () => analyzeCustomerServiceEmail(fixture),
    Error,
    "incomplete",
  );
  assertEquals(fixture.calls.text.length, 0);
});
Deno.test("linked request cannot be reanalyzed or overwritten", async () => {
  const fixture = await analysisFixture();
  fixture.receipt.requestId = 100;
  await assertRejects(
    () => analyzeCustomerServiceEmail(fixture),
    Error,
    "linked request",
  );
});
Deno.test("empty source records a problem instead of fabricating a homeowner or work", async () => {
  const fixture = await analysisFixture();
  fixture.receipt.sourcePayload = {};
  const report = await analyzeCustomerServiceEmail(fixture);
  assertEquals(report.issues.includes("EMPTY_SOURCE"), true);
  assertEquals(report.intakePayload, null);
});
