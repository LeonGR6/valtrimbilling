import { assert, assertEquals, assertThrows } from "@std/assert";
import { analyzePaymentScheduleContent } from "./paymentScheduleAnalysis.ts";
import {
  groupRows,
  normalizeCodeKey,
  PaymentScheduleError,
  parseMoneyCents,
} from "./paymentScheduleTypes.ts";
import type { ReleasePdfContent } from "./releasePdf.ts";
import type { PageContent, PageRule, TextRun } from "./releaseTypes.ts";

// Hand-built pages in the two layouts, so the parsers are covered without the
// private sample PDFs. Coordinates follow the real documents: amounts are right
// aligned under centered headers.

function run(text: string, x: number, y: number, width = 30): TextRun {
  return { text, x, y, width, height: 8 };
}

function page(runs: TextRun[], pageNumber = 1): PageContent {
  return { page: pageNumber, width: 612, height: 792, rotation: 0, runs, widgets: [] };
}

function content(...pages: PageContent[]): ReleasePdfContent {
  const runs = pages.flatMap((p) => p.runs);
  return {
    pageCount: pages.length,
    pageSizes: pages.map(({ page, width, height, rotation }) => ({
      page,
      width,
      height,
      rotation,
    })),
    pages,
    textLength: runs.reduce((sum, r) => sum + r.text.length, 0),
  };
}

function matrixPage(overrides: { total?: string; row2?: string[] } = {}) {
  const row2 = overrides.row2 ?? ["0015", "2B", "100.00", "50.00", "150.00"];
  return page([
    run("Payment Schedule", 40, 700, 80),
    run("480051", 40, 690),
    run("Frames Delivered-Fini", 120, 690, 90),
    run("480052", 40, 680),
    run("Trim Complete", 120, 680, 70),
    run("Phase", 45, 600, 25),
    run("Lot", 95, 600, 15),
    run("P/E", 139, 600, 17),
    run("480051", 178, 600, 36),
    run("480052", 223, 600, 36),
    run("Total Price", 280, 600, 50),
    run("1st Draw", 175, 591, 40),
    run("2nd Draw", 218, 591, 40),
    run("003", 38, 580, 15),
    run("0014", 103, 580, 20),
    run("4C", 127, 580, 12),
    run("100.00", 183, 580, 32),
    run("50.00", 232, 580, 26),
    run("150.00", 285, 580, 32),
    run("003", 38, 570, 15),
    run(row2[0], 103, 570, 20),
    run(row2[1], 127, 570, 12),
    run(row2[2], 183, 570, 32),
    run(row2[3], 232, 570, 26),
    run(row2[4], 285, 570, 32),
    run("Total Contract", 115, 560, 60),
    run("200.00", 183, 560, 32),
    run("100.00", 227, 560, 32),
    run(overrides.total ?? "300.00", 285, 560, 32),
    run("Previously Invoiced", 97, 540, 80),
    run("$", 172, 540, 5),
    run("$", 217, 540, 5),
    run("This Request", 118, 520, 60),
    run("$", 172, 520, 5),
    run("$", 217, 520, 5),
  ]);
}

function lineItemsPage(rows: Array<[string, string, string]>, total?: string, pageNumber = 1) {
  const runs = [
    run("Item", 62, 468, 20),
    run("Description", 178, 468, 50),
    run("Qty", 322, 468, 15),
    run("Rate", 390, 468, 20),
    run("Amount", 525, 468, 30),
  ];
  rows.forEach(([description, lot, amount], index) => {
    const y = 450 - index * 12;
    runs.push(
      run("1813 Finish Ca...", 39, y, 60),
      run(description, 109, y, 110),
      run("1", 357, y, 4),
      run(amount, 400, y, 35),
      run(lot, 438, y, 70),
      run(amount, 535, y, 35),
    );
  });
  if (total) runs.push(run("Total", 390, 54, 25), run(total, 522, 54, 45));
  return page(runs, pageNumber);
}

Deno.test("amounts, lots and rows are read the way the documents print them", () => {
  assertEquals(parseMoneyCents("1,929.04"), 192_904);
  assertEquals(parseMoneyCents("$198,121.00"), 19_812_100);
  assertEquals(parseMoneyCents("482.26"), 48_226);
  assertEquals(parseMoneyCents("1st Draw"), null);
  assertEquals(parseMoneyCents("4C"), null);
  assertEquals(parseMoneyCents("12"), null);

  assertEquals(normalizeCodeKey("0014"), "14");
  assertEquals(normalizeCodeKey(" 01 "), "1");
  assertEquals(normalizeCodeKey("0"), "0");
  assertEquals(normalizeCodeKey("01a"), "1A");
  assertEquals(normalizeCodeKey("0A"), "0A");

  const rows = groupRows([
    run("b", 50, 100.4),
    run("a", 10, 100),
    run("c", 10, 80),
  ]);
  assertEquals(rows.map((row) => row.runs.map((r) => r.text)), [["a", "b"], ["c"]]);
});

Deno.test("a matrix gives one cell per Lot and draw, with the draw names", () => {
  const analysis = analyzePaymentScheduleContent(content(matrixPage()));

  assertEquals(analysis.layout, "matrix");
  assertEquals(analysis.issues, []);
  assertEquals(analysis.cells.length, 4);
  assertEquals(analysis.expectedTotalCents, 30_000);
  assertEquals(analysis.draws, [
    { draw: 1, name: "Frames Delivered-Fini", costCode: "480051" },
    { draw: 2, name: "Trim Complete", costCode: "480052" },
  ]);

  const cell = analysis.cells.find((c) => c.lot === "0015" && c.draw === 2)!;
  assertEquals(cell.phase, "003");
  assertEquals(cell.amount, 50);
  assertEquals(cell.page, 1);
  // Below the first row and in the second draw column.
  const first = analysis.cells.find((c) => c.lot === "0014" && c.draw === 2)!;
  assert(cell.rect.y > first.rect.y);
  assertEquals(cell.rect.x, first.rect.x);
});

Deno.test("a matrix flags rows and totals that do not add up", () => {
  const rowMismatch = analyzePaymentScheduleContent(content(matrixPage({
    row2: ["0015", "2B", "100.00", "50.00", "160.00"],
  })));
  assertEquals(rowMismatch.issues.map((i) => i.code), ["row_total_mismatch"]);
  assertEquals(rowMismatch.issues[0].lot, "0015");

  const columns = analyzePaymentScheduleContent(content(matrixPage({
    row2: ["0015", "2B", "100.00", "55.00", "155.00"],
  })));
  assertEquals(columns.issues.map((i) => i.code), [
    "column_total_mismatch",
    "grand_total_mismatch",
  ]);
  assertEquals(columns.issues[0].draw, 2);
});

Deno.test("a matrix with the same Lot twice keeps the first and says so", () => {
  const analysis = analyzePaymentScheduleContent(content(matrixPage({
    row2: ["14", "2B", "100.00", "50.00", "150.00"],
  })));
  assertEquals(analysis.cells.length, 2);
  assertEquals(
    analysis.issues.filter((i) => i.code === "duplicate_cell").map((i) => i.draw),
    [1, 2],
  );
});

Deno.test("line items give a cell per row, highlighting the whole row", () => {
  const analysis = analyzePaymentScheduleContent(content(lineItemsPage([
    ["DRAW 1 15% Frames Delivered", "Lot 01 - 2653 ...", "1,735.05"],
    ["DRAW 2 65% Trim Complete", "Lot 01 - 2653 ...", "7,518.55"],
    ["DRAW 1 15% Frames Delivered", "Lot 02 - 2653 ...", "1,165.05"],
  ], "$10,418.65")));

  assertEquals(analysis.layout, "line_items");
  assertEquals(analysis.issues, []);
  assertEquals(analysis.cells.map((c) => [c.lot, c.draw, c.amount]), [
    ["01", 1, 1735.05],
    ["01", 2, 7518.55],
    ["02", 1, 1165.05],
  ]);
  assertEquals(analysis.draws, [
    { draw: 1, name: "Frames Delivered", costCode: null },
    { draw: 2, name: "Trim Complete", costCode: null },
  ]);
  assertEquals(analysis.cells[0].phase, null);
  assert(analysis.cells[0].rect.x < 0.1 && analysis.cells[0].rect.w > 0.8);
});

Deno.test("line items carry over pages without a header and flag a wrong total", () => {
  const analysis = analyzePaymentScheduleContent(content(
    lineItemsPage([["DRAW 1 15% Frames", "Lot 08 - 1 ...", "864.45"]]),
    page([
      run("DRAW 2 65% Trim", 109, 450, 110),
      run("3,745.95", 535, 450, 35),
      run("Lot 08 - 1 ...", 438, 450, 70),
      run("Total", 390, 54, 25),
      run("$5,000.00", 522, 54, 45),
    ], 2),
  ));

  assertEquals(analysis.cells.map((c) => [c.lot, c.draw, c.page]), [
    ["08", 1, 1],
    ["08", 2, 2],
  ]);
  assertEquals(analysis.issues.map((i) => i.code), ["grand_total_mismatch"]);
});

Deno.test("a PDF without text or without a schedule is rejected with a reason", () => {
  const scan = assertThrows(
    () => analyzePaymentScheduleContent(content(page([]))),
    PaymentScheduleError,
  );
  assertEquals(scan.reason, "no_text");

  const other = assertThrows(
    () =>
      analyzePaymentScheduleContent(content(page([
        run("This is a letter about something that is not a schedule at all", 40, 700, 300),
      ]))),
    PaymentScheduleError,
  );
  assertEquals(other.reason, "unrecognized_layout");
});

Deno.test("a matrix finds the Previously Invoiced and This Request boxes, one per draw", () => {
  const { summaryRows } = analyzePaymentScheduleContent(content(matrixPage()));
  assert(summaryRows);

  for (const row of [summaryRows.previouslyInvoiced, summaryRows.thisRequest]) {
    assertEquals(row.map((target) => [target.draw, target.page]), [[1, 1], [2, 1]]);
    // Draw 2 sits to the right of draw 1, on the same line.
    assert(row[1].rect.x > row[0].rect.x);
    assertEquals(row[0].rect.y, row[1].rect.y);
    // A box is wide enough for an amount and stays inside its cell.
    assert(row[0].rect.w * 612 > 25);
    assert(row[0].rect.x + row[0].rect.w < row[1].rect.x);
  }
  // This Request is the row below Previously Invoiced.
  assert(summaryRows.thisRequest[0].rect.y > summaryRows.previouslyInvoiced[0].rect.y);
});

Deno.test("a schedule without those rows, and a list, have no summary rows", () => {
  const withoutRows = matrixPage();
  withoutRows.runs = withoutRows.runs.filter((r) => !/Previously|This Request|^\$$/u.test(r.text));
  assertEquals(analyzePaymentScheduleContent(content(withoutRows)).summaryRows, null);

  const list = analyzePaymentScheduleContent(content(lineItemsPage([
    ["DRAW 1 15% Frames Delivered", "Lot 01 - 2653 ...", "1,735.05"],
  ], "$1,735.05")));
  assertEquals(list.summaryRows, null);
});

// --- Previously Invoiced and This Request: every draw gets a box, with or without "$" ---

// The page of matrixPage() as the points the boxes cover, for readable assertions.
function points(rect: { x: number; y: number; w: number; h: number }) {
  return {
    left: rect.x * 612,
    right: (rect.x + rect.w) * 612,
    top: 792 - rect.y * 792,
    bottom: 792 - (rect.y + rect.h) * 792,
  };
}

function near(actual: number, expected: number, message: string) {
  assert(Math.abs(actual - expected) < 0.01, `${message}: ${actual} is not ${expected}`);
}

function withoutSigns(source: PageContent) {
  return { ...source, runs: source.runs.filter((r) => r.text.trim() !== "$") };
}

function rule(x0: number, y0: number, x1: number, y1: number): PageRule {
  return { x0, y0, x1, y1 };
}

// The borders of the cells of matrixPage(): lines at x 168, 218.5 and 262 for the two
// draws, and at y 510, 530 and 550 for the two rows.
const CELL_COLUMNS = [168, 218.5, 262].map((x) => rule(x, 505, x + 0.5, 555));
const CELL_ROWS = [510, 530, 550].map((y) => rule(40, y, 300, y + 0.5));

function summaryOf(source: PageContent) {
  const { summaryRows } = analyzePaymentScheduleContent(content(source));
  assert(summaryRows);
  return summaryRows;
}

Deno.test("cells without a $ are found from the borders of the table", () => {
  const rows = summaryOf({
    ...withoutSigns(matrixPage()),
    rules: [...CELL_COLUMNS, ...CELL_ROWS],
  });

  for (const [row, bottom, top] of [
    [rows.previouslyInvoiced, 531.1, 549.4],
    [rows.thisRequest, 511.1, 529.4],
  ] as const) {
    assertEquals(row.map((target) => target.draw), [1, 2]);
    const [first, second] = row.map((target) => points(target.rect));
    // The whole cell, a little inside its borders.
    near(first.left, 169.1, "draw 1 left");
    near(first.right, 217.9, "draw 1 right");
    near(second.left, 219.6, "draw 2 left");
    near(second.right, 261.4, "draw 2 right");
    near(first.bottom, bottom, "bottom");
    near(first.top, top, "top");
    near(second.bottom, bottom, "draw 2 bottom");
  }
});

Deno.test("a $ in a cell moves its box to the right of the sign; the other cells keep their width", () => {
  const source = withoutSigns(matrixPage());
  const rows = summaryOf({
    ...source,
    // Only the first cell of This Request prints a $.
    runs: [...source.runs, run("$", 172, 520, 5)],
    rules: [...CELL_COLUMNS, ...CELL_ROWS],
  });

  const [first, second] = rows.thisRequest.map((target) => points(target.rect));
  near(first.left, 178, "after the sign");
  near(first.right, 217.9, "draw 1 right");
  near(second.left, 219.6, "draw 2 whole cell");
  // Previously Invoiced prints no $ at all.
  near(points(rows.previouslyInvoiced[0].rect).left, 169.1, "no sign, whole cell");
});

Deno.test("without borders or $ the boxes follow the columns the amounts sit in", () => {
  const rows = summaryOf(withoutSigns(matrixPage()));

  for (const row of [rows.previouslyInvoiced, rows.thisRequest]) {
    assertEquals(row.map((target) => target.draw), [1, 2]);
    const [first, second] = row.map((target) => points(target.rect));
    // Amounts end at 215 and 258: their cells end a few points after, one after the other.
    assert(first.right > 215 && first.right <= 219, `draw 1 right ${first.right}`);
    assert(second.right > 258 && second.right <= 262, `draw 2 right ${second.right}`);
    assert(first.right <= second.left, "the boxes do not touch");
    assert(second.left - first.right < 3, "and sit next to each other");
    assert(first.right - first.left > 25 && second.right - second.left > 25, "wide enough for an amount");
  }
  assert(rows.thisRequest[0].rect.y > rows.previouslyInvoiced[0].rect.y);
});

Deno.test("a $ in only one cell does not leave the other draws without a box", () => {
  const source = withoutSigns(matrixPage());
  const rows = summaryOf({ ...source, runs: [...source.runs, run("$", 172, 520, 5)] });

  assertEquals(rows.thisRequest.map((target) => target.draw), [1, 2]);
  assertEquals(rows.previouslyInvoiced.map((target) => target.draw), [1, 2]);
  const [first, second] = rows.thisRequest.map((target) => points(target.rect));
  // The first box starts at its $ (the sign ends at 177, the box keeps its usual 1.5 margin);
  // none reaches into the next cell.
  assert(first.left > 176 && first.left < 178, `starts at ${first.left}`);
  assert(first.right <= second.left + 0.01);
});

Deno.test("borders that only run across still give every draw a box, in the row's height", () => {
  const rows = summaryOf({ ...withoutSigns(matrixPage()), rules: CELL_ROWS });

  const [first, second] = rows.previouslyInvoiced.map((target) => points(target.rect));
  assertEquals(rows.previouslyInvoiced.map((target) => target.draw), [1, 2]);
  near(first.bottom, 531.1, "row bottom");
  near(first.top, 549.4, "row top");
  near(second.bottom, 531.1, "draw 2 row bottom");
  assert(first.right <= second.left + 0.01);
});

Deno.test("a border too far away to be the cell's is not used", () => {
  // A line across the whole page, 300 points from the draws, is not a cell border.
  const rows = summaryOf({
    ...withoutSigns(matrixPage()),
    rules: [rule(5, 505, 5.5, 555), rule(600, 505, 600.5, 555), ...CELL_ROWS],
  });

  const [first] = rows.thisRequest.map((target) => points(target.rect));
  assert(first.right - first.left < 60, `${first.right - first.left} wide`);
});
