import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  buildLines,
  detectLabelsInLines,
  detectReleaseFields,
} from "./releaseFields.ts";
import type { PageContent, ReleaseVariable, TextRun, Widget } from "./releaseTypes.ts";

// Synthetic pages that copy the layouts of the real forms (US Letter, points,
// origin bottom-left). No real document content is used.

function run(text: string, x: number, y: number, width: number): TextRun {
  return { text, x, y, width, height: 11 };
}

function widget(
  name: string,
  rect: [number, number, number, number],
  value = "",
): Widget {
  return { name, rect, value };
}

function page(runs: TextRun[], widgets: Widget[] = []): PageContent {
  return { page: 1, width: 612, height: 792, rotation: 0, runs, widgets };
}

function find(
  result: ReturnType<typeof detectReleaseFields>,
  variable: ReleaseVariable,
) {
  return result.suggestions.filter((suggestion) =>
    suggestion.variable === variable
  );
}

const bodyText = [
  run("for labor and service provided to the customer on this job through", 72, 447, 464),
  run("the Through Date of this document. Rights based upon labor or service", 72, 435, 430),
  run("Date(s) of waiver and release:________________________________________", 108, 220, 355),
  run("Amount(s) of unpaid progress payment(s): $_____________________________", 108, 208, 357),
];

Deno.test("buildLines joins runs on one baseline and separates the next line", () => {
  const lines = buildLines([
    run("$", 164, 350.4, 5),
    run("Amount of Check:", 72, 350, 88),
    run("Through Date:", 72, 510, 64),
  ]);
  assertEquals(lines.map(({ text }) => text), ["Through Date:", "Amount of Check: $"]);
  assertEquals(lines[1].x0, 72);
});

Deno.test("a fillable form matches labels to the field beside them", () => {
  const result = detectReleaseFields([
    page([
      run("Through Date:", 72, 510, 64),
      run("Maker of Check:", 72, 368, 73),
      run("Amount of Check: $", 72, 350, 90),
      ...bodyText,
    ], [
      widget("through date", [139, 505, 330, 520]),
      widget("maker", [147, 364, 545, 379]),
      widget("amount", [164, 346, 358, 361]),
      widget("amount_2", [304, 207, 464, 218]),
    ]),
  ]);

  const through = find(result, "through_date");
  assertEquals(through.length, 1);
  assertEquals(through[0].fieldName, "through date");
  assertEquals(through[0].source, "acroform");
  assertEquals(through[0].state, "blank");
  assertEquals(through[0].label, "Through Date:");
  assertAlmostEquals(through[0].rect!.x, 139 / 612, 1e-4);
  assertAlmostEquals(through[0].rect!.y, (792 - 520) / 792, 1e-4);

  const amount = find(result, "check_amount");
  assertEquals(amount.length, 1);
  assertEquals(amount[0].fieldName, "amount");
  // This synthetic page has no "Date of Signature" label.
  assertEquals(result.missing, ["signature_date", "disputed_claims_amount"]);
  assertEquals(result.hasWidgets, true);
});

Deno.test("a second amount field is not mistaken for the check amount", () => {
  const result = detectReleaseFields([
    page([
      run("Amount of Check: $", 72, 352, 90),
      run("Disputed claims for extras in the amount of: $", 72, 260, 200),
    ], [
      widget("amount", [163, 348, 358, 363]),
      widget("amount_2", [274, 255, 459, 271]),
    ]),
  ]);
  const amount = find(result, "check_amount");
  assertEquals(amount.map(({ fieldName }) => fieldName), ["amount"]);
});

Deno.test("a field that is only named 'amount' is not taken for the check amount", () => {
  // In the final forms the field called "amount" holds the disputed-claims
  // amount, and the unconditional one has no check amount at all.
  const result = detectReleaseFields([
    page([
      run("Exceptions", 278, 338, 53),
      run("Disputed claims for extras in the amount of: $", 78, 308, 200),
      run("Date of Signature:", 78, 209, 81),
    ], [
      widget("amount", [281, 301, 468, 317]),
      widget("date", [161, 204, 352, 220]),
    ]),
  ]);
  assertEquals(result.suggestions.map(({ variable }) => variable).sort(), [
    "disputed_claims_amount",
    "signature_date",
  ]);
  assertEquals(find(result, "disputed_claims_amount")[0].fieldName, "amount");
  assertEquals(result.missing, [
    "through_date",
    "check_amount",
    "waiver_release_dates",
    "unpaid_progress_amount",
  ]);
});

Deno.test("the amount line below a payment sentence uses the field under it", () => {
  const result = detectReleaseFields([
    page([
      run("Through Date:", 72, 492, 64),
      run("The claimant has received the following progress payment:", 72, 372, 392),
      run("$___________________________________", 72, 349, 200),
    ], [
      widget("through date", [139, 487, 331, 503]),
      widget("amount", [80, 349, 267, 364]),
    ]),
  ]);
  const amount = find(result, "check_amount");
  assertEquals(amount.length, 1);
  assertEquals(amount[0].fieldName, "amount");
  assertEquals(amount[0].source, "acroform");
  assert(amount[0].confidence < find(result, "through_date")[0].confidence);
});

Deno.test("without form fields the blank line below the sentence is used", () => {
  const result = detectReleaseFields([
    page([
      run("The claimant has received the following progress payment:", 72, 372, 392),
      run("$___________________________________", 72, 349, 200),
    ]),
  ]);
  const amount = find(result, "check_amount");
  assertEquals(amount.length, 1);
  assertEquals(amount[0].source, "text_layer");
  assertEquals(amount[0].state, "blank");
  assertAlmostEquals(amount[0].rect!.x, 72 / 612, 1e-4);
});

Deno.test("a partially filled flat document only offers the blank labels", () => {
  const result = detectReleaseFields([
    page([
      run("Through Date:", 72, 510, 64),
      run("Maker of Check: FILLED PREVIOUSLY", 72, 368, 177),
      run("Amount of Check: $", 72, 350, 90),
      run("Check Payable to: FILLED PREVIOUSLY", 72, 332, 185),
      ...bodyText,
    ]),
  ]);

  const through = find(result, "through_date");
  assertEquals(through.length, 1);
  assertEquals(through[0].source, "text_layer");
  assertEquals(through[0].state, "blank");
  assert(through[0].rect !== null);
  assertEquals(through[0].fieldName, null);
  // The value area starts just after the label and stays on the page.
  assert(through[0].rect!.x > 136 / 612);
  assert(through[0].rect!.x + through[0].rect!.w <= 1);

  const amount = find(result, "check_amount");
  assertEquals(amount.length, 1);
  assertEquals(amount[0].state, "blank");
  assertEquals(result.hasWidgets, false);
});

Deno.test("a label that already has a value is reported as filled without a rectangle", () => {
  const result = detectReleaseFields([
    page([
      run("Through Date: 09/30/2026", 72, 510, 150),
      run("Amount of Check: $ 1,250.00", 72, 350, 150),
    ]),
  ]);
  for (const variable of ["through_date", "check_amount"] as const) {
    const [suggestion] = find(result, variable);
    assertEquals(suggestion.state, "filled");
    assertEquals(suggestion.rect, null);
  }
});

Deno.test("a filled form field is reported as filled but keeps its rectangle", () => {
  const result = detectReleaseFields([
    page([run("Through Date:", 72, 510, 64)], [
      widget("through date", [139, 505, 330, 520], "09/30/2026"),
    ]),
  ]);
  const [through] = find(result, "through_date");
  assertEquals(through.state, "filled");
  assert(through.rect !== null);
  assert(through.confidence <= 0.6);
});

Deno.test("sentences that mention the Through Date are not labels", () => {
  const result = detectReleaseFields([page(bodyText.slice(0, 2))]);
  assertEquals(result.suggestions, []);
});

Deno.test("a page without text yields no suggestions and lists both variables as missing", () => {
  const result = detectReleaseFields([page([])]);
  assertEquals(result.suggestions, []);
  assertEquals(result.missing, [
    "through_date",
    "check_amount",
    "signature_date",
    "waiver_release_dates",
    "unpaid_progress_amount",
    "disputed_claims_amount",
  ]);
});

Deno.test("the signature date is found next to its form field", () => {
  const result = detectReleaseFields([
    page([run("Date of Signature:", 72, 161, 81)], [
      widget("date", [155, 157, 349, 172]),
    ]),
  ]);
  const [signature] = find(result, "signature_date");
  assertEquals(signature.fieldName, "date");
  assertEquals(signature.state, "blank");
  assertEquals(signature.page, 1);
  assertEquals(signature.label, "Date of Signature:");
});

Deno.test("the signature date works on a flat document and ignores other 'date' lines", () => {
  const result = detectReleaseFields([
    page([
      run("Date(s) of waiver and release:________________________________", 108, 220, 355),
      run("Date of Signature:", 72, 94, 81),
    ]),
  ]);
  const signatures = find(result, "signature_date");
  assertEquals(signatures.length, 1);
  assertEquals(signatures[0].source, "text_layer");
  assertEquals(signatures[0].state, "blank");
});

Deno.test("suggestions are ranked by confidence", () => {
  const result = detectReleaseFields([
    page([
      run("Through Date:", 72, 510, 64),
      run("Amount of Check: $", 72, 350, 90),
    ], [widget("amount", [164, 346, 358, 361])]),
  ]);
  const confidences = result.suggestions.map(({ confidence }) => confidence);
  assertEquals(confidences, [...confidences].sort((a, b) => b - a));
  assertEquals(result.suggestions[0].variable, "check_amount");
});

Deno.test("OCR lines give labels without rectangles and tell blank from filled", () => {
  const suggestions = detectLabelsInLines([
    ["CONDITIONAL WAIVER", "Through Date:", "Amount of Check: $ 1,250.00"],
    ["Date of Signature:"],
  ]);
  const by = (variable: string) =>
    suggestions.find((suggestion) => suggestion.variable === variable)!;

  assertEquals(by("through_date").state, "blank");
  assertEquals(by("through_date").page, 1);
  assertEquals(by("check_amount").state, "filled");
  assertEquals(by("signature_date").page, 2);
  for (const suggestion of suggestions) {
    assertEquals(suggestion.source, "ocr");
    assertEquals(suggestion.rect, null);
    assertEquals(suggestion.fieldName, null);
  }
});

Deno.test("OCR keeps the payment sentence only when a blank line follows it", () => {
  const withBlank = detectLabelsInLines([[
    "The claimant has received the following progress payment:",
    "$______________",
  ]]);
  assertEquals(withBlank.map(({ variable }) => variable), ["check_amount"]);

  const withoutBlank = detectLabelsInLines([[
    "The claimant has received the following progress payment:",
    "Exceptions",
  ]]);
  assertEquals(withoutBlank, []);
});

// The two blanks of the "Exceptions" part of the Conditional Progress form. A
// label is followed by a line of underscores and the form field is drawn over
// those underscores (real positions: field "affect" 243-464 and "amount_2"
// 304-464, on lines whose text spans 108-463 and 108-465 at 9.8 pt).
function underlinedLines() {
  const small = (text: string, y: number, width: number): TextRun => ({
    text, x: 108, y, width, height: 9.8,
  });
  return [
    small("Date(s) of waiver and release:" + "_".repeat(40), 220, 355),
    small("Amount(s) of unpaid progress payment(s): $" + "_".repeat(29), 208, 357),
  ];
}

Deno.test("the two exception blanks are matched to the fields drawn over their underscores", () => {
  const result = detectReleaseFields([
    page(underlinedLines(), [
      widget("affect", [243, 218, 464, 231]),
      widget("amount_2", [304, 207, 464, 218]),
    ]),
  ]);

  const [dates] = find(result, "waiver_release_dates");
  assertEquals(dates.fieldName, "affect");
  assertEquals(dates.source, "acroform");
  assertEquals(dates.state, "blank");
  assertEquals(dates.label, "Date(s) of waiver and release:");
  assertAlmostEquals(dates.rect!.x, 243 / 612, 1e-4);

  const [amount] = find(result, "unpaid_progress_amount");
  assertEquals(amount.fieldName, "amount_2");
  assertAlmostEquals(amount.rect!.x, 304 / 612, 1e-4);
  assertEquals(find(result, "check_amount"), []);
});

Deno.test("on a flat document the box covers the underscores after the label", () => {
  const result = detectReleaseFields([page(underlinedLines())]);

  const [dates] = find(result, "waiver_release_dates");
  assertEquals(dates.source, "text_layer");
  assertEquals(dates.state, "blank");
  // The label text ends near x 243 and the underscores end at 463.
  assertAlmostEquals(dates.rect!.x, 246 / 612, 0.01);
  assertAlmostEquals(dates.rect!.x + dates.rect!.w, 463 / 612, 0.002);

  const [amount] = find(result, "unpaid_progress_amount");
  assertAlmostEquals(amount.rect!.x, 307 / 612, 0.01);
  assertAlmostEquals(amount.rect!.x + amount.rect!.w, 465 / 612, 0.002);
});

Deno.test("an exception line that already has a value is reported as filled", () => {
  const result = detectReleaseFields([
    page([
      { text: "Date(s) of waiver and release: 08/15/2026", x: 108, y: 220, width: 300, height: 9.8 },
    ]),
  ]);
  const [dates] = find(result, "waiver_release_dates");
  assertEquals(dates.state, "filled");
  assertEquals(dates.rect, null);
});

Deno.test("the Disputed claims amount is its own variable, not the unpaid progress payment", () => {
  const result = detectReleaseFields([
    page([run("Disputed claims for extras in the amount of: $", 72, 260, 200)], [
      widget("amount_2", [274, 255, 459, 271]),
    ]),
  ]);
  assertEquals(result.suggestions.map(({ variable }) => variable), [
    "disputed_claims_amount",
  ]);
  assertEquals(result.suggestions[0].fieldName, "amount_2");
});
