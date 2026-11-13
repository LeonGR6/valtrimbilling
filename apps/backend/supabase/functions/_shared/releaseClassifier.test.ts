import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  classifyReleaseType,
  isReleaseType,
  REVIEW_CONFIDENCE_THRESHOLD,
} from "./releaseClassifier.ts";

// The notices below mimic the statutory forms. The unconditional notice ends
// by telling people to use a CONDITIONAL form, and the conditional notices
// mention the payment, so the body can never decide the type.
const unconditionalNotice = [
  "NOTICE TO CLAIMANT: THIS DOCUMENT WAIVES AND RELEASES LIEN, STOP",
  "PAYMENT NOTICE, AND PAYMENT BOND RIGHTS UNCONDITIONALLY AND",
  "STATES THAT YOU HAVE BEEN PAID FOR GIVING UP THOSE RIGHTS. THIS",
  "DOCUMENT IS ENFORCEABLE AGAINST YOU IF YOU SIGN IT, EVEN IF YOU",
  "HAVE NOT BEEN PAID. IF YOU HAVE NOT BEEN PAID, USE A CONDITIONAL",
  "WAIVER AND RELEASE FORM.",
];

const conditionalNotice = [
  "NOTICE: THIS DOCUMENT WAIVES THE CLAIMANT'S LIEN, STOP PAYMENT",
  "NOTICE, AND PAYMENT BOND RIGHTS EFFECTIVE ON RECEIPT OF PAYMENT.",
  "A PERSON SHOULD NOT RELY ON THIS DOCUMENT UNLESS SATISFIED THAT",
  "THE CLAIMANT HAS RECEIVED THAT PAYMENT. UNCONDITIONAL FORMS EXIST",
  "FOR FINAL PAYMENT AND PROGRESS PAYMENT.",
];

function lines(title: string | string[], notice: string[], date = "7/1/12") {
  return [date, ...(Array.isArray(title) ? title : [title]), ...notice];
}

Deno.test("each statutory title maps to its Release type", () => {
  const cases = [
    [
      "CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
      "ConditionalWaiverAndReleaseOnProgressPayment",
      conditionalNotice,
    ],
    [
      "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
      "ConditionalWaiverAndReleaseOnFinalPayment",
      conditionalNotice,
    ],
    [
      "UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
      "UnconditionalWaiverAndReleaseOnProgressPayment",
      unconditionalNotice,
    ],
    [
      "UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
      "UnconditionalWaiverAndReleaseOnFinalPayment",
      unconditionalNotice,
    ],
  ] as const;

  for (const [title, expected, notice] of cases) {
    const result = classifyReleaseType({ firstPageLines: lines(title, notice) });
    assertEquals(result.releaseType, expected, title);
    assertEquals(result.method, "title_rules");
    assert(result.confidence >= 0.95);
    assertEquals(result.needsTiebreak, false);
    assertStringIncludes(result.evidence.toUpperCase(), title);
  }
});

Deno.test("'unconditional' is never read as 'conditional'", () => {
  const result = classifyReleaseType({
    firstPageLines: lines(
      "UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
      unconditionalNotice,
    ),
  });
  assertEquals(
    result.releaseType,
    "UnconditionalWaiverAndReleaseOnProgressPayment",
  );
  assertEquals(result.candidates[0].score, 1);
  assertEquals(result.candidates.length, 1);
});

Deno.test("the notice that says 'use a conditional waiver' does not change an unconditional title", () => {
  const result = classifyReleaseType({
    firstPageLines: lines(
      "UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
      unconditionalNotice,
    ),
  });
  assertEquals(result.releaseType, "UnconditionalWaiverAndReleaseOnFinalPayment");
  assertEquals(result.method, "title_rules");
});

Deno.test("a conditional title is not turned unconditional by body words", () => {
  const result = classifyReleaseType({
    firstPageLines: lines(
      "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
      conditionalNotice,
    ),
  });
  assertEquals(result.releaseType, "ConditionalWaiverAndReleaseOnFinalPayment");
});

Deno.test("a title split over two lines is still recognised", () => {
  const result = classifyReleaseType({
    firstPageLines: lines(
      ["CONDITIONAL WAIVER AND RELEASE ON", "PROGRESS PAYMENT"],
      conditionalNotice,
    ),
  });
  assertEquals(
    result.releaseType,
    "ConditionalWaiverAndReleaseOnProgressPayment",
  );
  assertEquals(result.method, "title_rules");
});

Deno.test("case, spacing and a missing version date do not matter", () => {
  const result = classifyReleaseType({
    firstPageLines: [
      "  Unconditional Waiver  and Release on   Final Payment ",
      ...unconditionalNotice,
    ],
  });
  assertEquals(result.releaseType, "UnconditionalWaiverAndReleaseOnFinalPayment");
});

Deno.test("progress and final are told apart by the payment phrase", () => {
  const progress = classifyReleaseType({
    firstPageLines: lines(
      "CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
      ["THE FINAL PAYMENT FORM IS A DIFFERENT DOCUMENT."],
    ),
  });
  assertEquals(
    progress.releaseType,
    "ConditionalWaiverAndReleaseOnProgressPayment",
  );
});

Deno.test("a title that names both kinds is ambiguous and asks for a tie-break", () => {
  const result = classifyReleaseType({
    firstPageLines: lines(
      "CONDITIONAL AND UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
      [],
    ),
  });
  assertEquals(result.releaseType, null);
  assertEquals(result.needsTiebreak, true);
  assertEquals(result.candidates.length, 2);
  assert(
    result.candidates.every(({ releaseType }) =>
      releaseType.endsWith("OnProgressPayment")
    ),
  );
});

Deno.test("a title further down page 1 is trusted less and needs review", () => {
  const filler = Array.from({ length: 8 }, (_, index) => `Header line ${index}`);
  const result = classifyReleaseType({
    firstPageLines: [
      ...filler,
      "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
    ],
  });
  assertEquals(result.releaseType, "ConditionalWaiverAndReleaseOnFinalPayment");
  assertEquals(result.method, "wide_rules");
  assert(result.confidence < REVIEW_CONFIDENCE_THRESHOLD);
  assertEquals(result.needsTiebreak, true);
});

Deno.test("the file name is only a weak fallback when the text says nothing", () => {
  const result = classifyReleaseType({
    firstPageLines: ["Scanned page", "No readable title"],
    fileName: "Unconditional-Progress.PDF",
  });
  assertEquals(
    result.releaseType,
    "UnconditionalWaiverAndReleaseOnProgressPayment",
  );
  assertEquals(result.method, "filename");
  assert(result.confidence <= 0.4);
  assertEquals(result.needsTiebreak, true);
});

Deno.test("the file name never overrules a recognised title", () => {
  const result = classifyReleaseType({
    firstPageLines: lines(
      "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
      conditionalNotice,
    ),
    fileName: "unconditional-progress.pdf",
  });
  assertEquals(result.releaseType, "ConditionalWaiverAndReleaseOnFinalPayment");
  assertEquals(result.method, "title_rules");
});

Deno.test("a document that is not a Release stays unclassified", () => {
  const result = classifyReleaseType({
    firstPageLines: ["INVOICE", "Bill to: Example Builder", "Amount due"],
  });
  assertEquals(result.releaseType, null);
  assertEquals(result.method, "none");
  assertEquals(result.confidence, 0);
  assertEquals(result.needsTiebreak, true);
});

Deno.test("an empty first page does not throw", () => {
  const result = classifyReleaseType({ firstPageLines: [] });
  assertEquals(result.releaseType, null);
  assertEquals(result.evidence, "");
});

Deno.test("evidence is the form title, never body text", () => {
  const result = classifyReleaseType({
    firstPageLines: lines(
      "UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
      unconditionalNotice,
    ),
  });
  assert(result.evidence.length <= 120);
  assert(!result.evidence.includes("NOTICE"));
});

Deno.test("isReleaseType accepts only the four database values", () => {
  assert(isReleaseType("ConditionalWaiverAndReleaseOnFinalPayment"));
  assert(!isReleaseType("conditional-final"));
  assert(!isReleaseType(null));
});
