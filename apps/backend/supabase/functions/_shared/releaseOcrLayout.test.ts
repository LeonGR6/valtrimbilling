import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { detectReleaseFields } from "./releaseFields.ts";
import type { OcrBlock, OcrPage } from "./releaseOcr.ts";
import { ocrPagesToContent } from "./releaseOcrLayout.ts";

// A US Letter page (612 x 792 pt) scanned at 2x: 1224 x 1584 px.
const letter = { width: 612, height: 792 };
const px = 2;

function page(blocks: OcrBlock[], overrides: Partial<OcrPage> = {}): OcrPage {
  return { lines: [], blocks, width: 1224, height: 1584, ...overrides };
}

// A block from a top-left box given in points.
function block(text: string, left: number, top: number, right: number, bottom: number): OcrBlock {
  return { text, left: left * px, top: top * px, right: right * px, bottom: bottom * px };
}

Deno.test("a single-line block keeps its exact position in PDF points", () => {
  const [content] = ocrPagesToContent(
    [page([block("Through Date:", 72, 273, 136, 284)])],
    [letter],
  );

  assert(content);
  assertEquals(content.page, 1);
  assertEquals(content.rotation, 0);
  assertEquals(content.widgets, []);
  const [run] = content.runs;
  assertEquals(run.text, "Through Date:");
  assertAlmostEquals(run.x, 72, 1e-6);
  assertAlmostEquals(run.width, 64, 1e-6);
  // Baseline a little above the bottom of the band, measured from the page bottom.
  assertAlmostEquals(run.y, 792 - (284 - 11 * 0.2), 1e-6);
});

Deno.test("a block with several lines is split into equal bands", () => {
  const [content] = ocrPagesToContent(
    [page([block("| Name of Claimant: | |\n|---|---|\n| Through Date: | |", 72, 200, 545, 236)])],
    [letter],
  );

  const [first, second] = content!.runs;
  assertEquals([first.text, second.text], ["Name of Claimant:", "Through Date:"]);
  // 36 pt over 2 lines: each band is 18 pt tall.
  assertAlmostEquals(first.y - second.y, 18, 1e-6);
  // The block spans the whole table, but a line is never wider than its text.
  assert(second.width < first.width);
  assertAlmostEquals(first.width, 17 * 5, 1e-6);
});

Deno.test("character width is measured on single-line blocks of the same page", () => {
  const [calibrated] = ocrPagesToContent(
    [page([
      // 13 characters in 52 pt: 4 pt per character.
      block("Through Date:", 72, 273, 124, 284),
      block("| Name of Claimant: |\n| Owner: |", 72, 100, 545, 136),
    ])],
    [letter],
  );
  const claimant = calibrated!.runs.find((run) => run.text === "Name of Claimant:")!;
  assertAlmostEquals(claimant.width, 17 * 4, 1e-6);
});

Deno.test("a lone label is turned into a box that sits right after it", () => {
  const [content] = ocrPagesToContent(
    [page([block("Through Date:", 72, 273, 136, 284)])],
    [letter],
  );
  const { suggestions } = detectReleaseFields([content!]);

  assertEquals(suggestions.length, 1);
  const [through] = suggestions;
  assertEquals(through.variable, "through_date");
  assertEquals(through.state, "blank");
  // The real field of this form starts at x 139 pt, y 0.343 of the page.
  assertAlmostEquals(through.rect!.x, 139 / 612, 0.004);
  assertAlmostEquals(through.rect!.y, 0.343, 0.005);
});

Deno.test("estimating inside a table that spans the page stays close to the true row", () => {
  // Five rows, 18 pt apart, as in the Identifying Information table; the
  // Through Date is the last. The block covers the whole table width. True
  // field: x 0.227, y 0.343. A single-line label on the page calibrates the
  // character width.
  const rows = ["Name of Claimant:", "Name of Customer:", "Job Location:", "Owner:", "Through Date:"];
  const [content] = ocrPagesToContent(
    [page([
      block(rows.map((row) => `| ${row} | |`).join("\n"), 72, 202, 545, 292),
      block("Amount of Check: $", 72, 433, 162, 444),
    ])],
    [letter],
  );
  const through = detectReleaseFields([content!]).suggestions
    .find((suggestion) => suggestion.variable === "through_date")!;

  assertAlmostEquals(through.rect!.y, 0.343, 0.02);
  assertAlmostEquals(through.rect!.x, 139 / 612, 0.03);
});

Deno.test("without a single-line block the default character width keeps the box near", () => {
  const rows = ["Name of Claimant:", "Owner:", "Through Date:"];
  const [content] = ocrPagesToContent(
    [page([block(rows.map((row) => `| ${row} | |`).join("\n"), 72, 238, 545, 292)])],
    [letter],
  );
  const [through] = detectReleaseFields([content!]).suggestions;
  assertAlmostEquals(through.rect!.x, 139 / 612, 0.04);
});

Deno.test("a rotated page uses its displayed size, so the box is a fraction of that page", () => {
  // A page stored as 612 x 792 but displayed rotated 90: 792 x 612.
  const [content] = ocrPagesToContent(
    [page([block("Through Date:", 72, 100, 136, 111)], { width: 1584, height: 1224 })],
    [{ width: 792, height: 612 }],
  );
  assertEquals(content!.width, 792);
  assertEquals(content!.height, 612);
  const [through] = detectReleaseFields([content!]).suggestions;
  assert(through.rect!.x + through.rect!.w <= 1);
});

Deno.test("pages without boxes or without a size give no content", () => {
  assertEquals(
    ocrPagesToContent(
      [page([]), page([block("x", 1, 1, 9, 9)], { width: null, height: null })],
      [letter, letter],
    ),
    [null, null],
  );
  // More OCR pages than known page sizes cannot be placed either.
  assertEquals(ocrPagesToContent([page([block("x", 1, 1, 9, 9)])], []), [null]);
});

Deno.test("blocks that clean up to nothing are skipped", () => {
  const [content] = ocrPagesToContent(
    [page([
      block("|---|---|", 10, 10, 50, 20),
      block("Through Date:", 72, 273, 136, 284),
    ])],
    [letter],
  );
  assertEquals(content!.runs.length, 1);
});
