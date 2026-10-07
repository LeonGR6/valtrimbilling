import { assert, assertEquals, assertRejects } from "@std/assert";
import { analyzeReleasePdf } from "./releaseAnalysis.ts";
import { OcrError } from "./releaseOcr.ts";
import { ReleasePdfError } from "./releasePdf.ts";
import type { ReleaseType } from "./releaseTypes.ts";

// A valid one-page PDF with no text: stands in for a scan.
const scannedPdf = new TextEncoder().encode(
  [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj",
    "trailer<</Root 1 0 R/Size 4>>",
    "%%EOF",
  ].join("\n"),
);

const clearTitle = [
  "UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
  "NOTICE TO CLAIMANT: THIS DOCUMENT WAIVES AND RELEASES LIEN",
  "Through Date:",
  "The claimant has received the following progress payment:",
  "$____________________",
  "Date of Signature:",
];

const ambiguousTitle = [
  "CONDITIONAL AND UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
];

Deno.test("a PDF with no text and no OCR configured fails with a fixable error", async () => {
  const error = await assertRejects(
    () => analyzeReleasePdf(scannedPdf, "scan.pdf"),
    OcrError,
  ) as OcrError;
  assertEquals(error.failure, "not_configured");
});

Deno.test("a scanned PDF is read with OCR and its labels carry no rectangle", async () => {
  let ocrCalls = 0;
  const analysis = await analyzeReleasePdf(scannedPdf, "scan.pdf", {
    ocr: (_bytes, pageCount) => {
      ocrCalls += 1;
      assertEquals(pageCount, 1);
      return Promise.resolve([clearTitle]);
    },
  });

  assertEquals(ocrCalls, 1);
  assertEquals(analysis.detectionMethod, "ocr");
  assertEquals(
    analysis.classification.releaseType,
    "UnconditionalWaiverAndReleaseOnProgressPayment",
  );
  assertEquals(analysis.pageCount, 1);
  assertEquals(analysis.pageSizes, [{ page: 1, width: 612, height: 792, rotation: 0 }]);

  const variables = analysis.suggestions.map(({ variable }) => variable).sort();
  assertEquals(variables, ["check_amount", "signature_date", "through_date"]);
  for (const suggestion of analysis.suggestions) {
    assertEquals(suggestion.source, "ocr");
    assertEquals(suggestion.rect, null);
    assertEquals(suggestion.page, 1);
  }
});

Deno.test("the tie-breaker is skipped when the title already decides", async () => {
  let calls = 0;
  const analysis = await analyzeReleasePdf(scannedPdf, "scan.pdf", {
    ocr: () => Promise.resolve([clearTitle]),
    tiebreak: () => {
      calls += 1;
      return Promise.resolve(null);
    },
  });
  assertEquals(calls, 0);
  assertEquals(analysis.classification.method, "title_rules");
});

Deno.test("the tie-breaker resolves an ambiguous title but never counts as certain", async () => {
  const analysis = await analyzeReleasePdf(scannedPdf, "scan.pdf", {
    ocr: () => Promise.resolve([ambiguousTitle]),
    tiebreak: ({ candidates }) => {
      assert(candidates.every((type) => type.endsWith("OnProgressPayment")));
      return Promise.resolve({
        releaseType: "UnconditionalWaiverAndReleaseOnProgressPayment" as ReleaseType,
        confidence: 0.99,
      });
    },
  });
  assertEquals(analysis.classification.method, "llm");
  assertEquals(
    analysis.classification.releaseType,
    "UnconditionalWaiverAndReleaseOnProgressPayment",
  );
  assert(analysis.classification.confidence <= 0.7);
  assertEquals(analysis.classification.needsTiebreak, true);
});

Deno.test("a tie-breaker answer outside the candidates is ignored", async () => {
  const analysis = await analyzeReleasePdf(scannedPdf, "scan.pdf", {
    ocr: () => Promise.resolve([ambiguousTitle]),
    tiebreak: () =>
      Promise.resolve({
        releaseType: "ConditionalWaiverAndReleaseOnFinalPayment" as ReleaseType,
        confidence: 0.9,
      }),
  });
  assertEquals(analysis.classification.releaseType, null);
  assertEquals(analysis.classification.method, "none");
});

Deno.test("a file that is not a PDF is rejected with a readable error", async () => {
  await assertRejects(
    () => analyzeReleasePdf(new TextEncoder().encode("not a pdf"), "x.pdf"),
    ReleasePdfError,
    "could not be opened",
  );
});

Deno.test("the analysis result is plain JSON the database can store", async () => {
  const analysis = await analyzeReleasePdf(scannedPdf, "scan.pdf", {
    ocr: () => Promise.resolve([clearTitle]),
  });
  assertEquals(JSON.parse(JSON.stringify(analysis)), analysis);
});
