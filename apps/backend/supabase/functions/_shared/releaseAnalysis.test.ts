import { assert, assertEquals, assertRejects } from "@std/assert";
import { analyzeReleasePdf } from "./releaseAnalysis.ts";
import { linesOnlyPage, OcrError, type OcrPage } from "./releaseOcr.ts";
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
      return Promise.resolve([linesOnlyPage(clearTitle)]);
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
    ocr: () => Promise.resolve([linesOnlyPage(clearTitle)]),
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
    ocr: () => Promise.resolve([linesOnlyPage(ambiguousTitle)]),
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
    ocr: () => Promise.resolve([linesOnlyPage(ambiguousTitle)]),
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
    ocr: () => Promise.resolve([linesOnlyPage(clearTitle)]),
  });
  assertEquals(JSON.parse(JSON.stringify(analysis)), analysis);
});

// A page as Mistral OCR reports it for a US Letter scan rendered at 2x
// (1224 x 1584 px): labels in paragraph blocks, coordinates in pixels. The
// positions come from the real "conditional-progress" form, whose true
// fields are Through Date (x .227 y .343) and Amount of Check (x .268 y .544).
const scannedWithBlocks: OcrPage = {
  lines: [],
  width: 1224,
  height: 1584,
  blocks: [
    { text: "# CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT", left: 300, top: 200, right: 920, bottom: 230 },
    { text: "Through Date:", left: 144, top: 546, right: 272, bottom: 568 },
    { text: "Amount of Check: $", left: 144, top: 866, right: 324, bottom: 888 },
    { text: "Date of Signature:", left: 144, top: 1566 - 1384 + 1180, right: 306, bottom: 1566 - 1384 + 1202 },
  ],
};

Deno.test("a scan with OCR boxes gets suggested boxes near the true fields", async () => {
  const analysis = await analyzeReleasePdf(scannedPdf, "scan.pdf", {
    ocr: () => Promise.resolve([{ ...scannedWithBlocks, lines: [
      "CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
      "Through Date:",
      "Amount of Check: $",
      "Date of Signature:",
    ] }]),
  });

  assertEquals(analysis.detectionMethod, "ocr");
  assertEquals(
    analysis.classification.releaseType,
    "ConditionalWaiverAndReleaseOnProgressPayment",
  );

  const by = (variable: string) =>
    analysis.suggestions.find((suggestion) => suggestion.variable === variable)!;
  const through = by("through_date");
  const amount = by("check_amount");

  for (const suggestion of analysis.suggestions) {
    assertEquals(suggestion.source, "ocr");
    assertEquals(suggestion.state, "blank");
    assertEquals(suggestion.fieldName, null);
    assert(suggestion.confidence <= 0.7);
    assert(suggestion.rect !== null);
    assert(suggestion.reason.includes("estimated from OCR"));
  }
  assert(Math.abs(through.rect!.x - 0.227) < 0.01);
  assert(Math.abs(through.rect!.y - 0.343) < 0.01);
  assert(Math.abs(amount.rect!.x - 0.268) < 0.02);
  assert(Math.abs(amount.rect!.y - 0.544) < 0.01);
});

Deno.test("OCR pages without usable boxes still list their labels", async () => {
  const analysis = await analyzeReleasePdf(scannedPdf, "scan.pdf", {
    ocr: () => Promise.resolve([linesOnlyPage(clearTitle)]),
  });
  assert(analysis.suggestions.length > 0);
  assert(analysis.suggestions.every(({ rect }) => rect === null));
});
