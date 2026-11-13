import { assert, assertEquals, assertThrows } from "@std/assert";
import { analyzePaymentScheduleContent } from "./paymentScheduleAnalysis.ts";
import { PaymentScheduleError } from "./paymentScheduleTypes.ts";
import type { DrawName } from "./paymentScheduleTypes.ts";
import type { ReleasePdfContent } from "./releasePdf.ts";
import type { PageContent, TextRun } from "./releaseTypes.ts";

// Schedules whose columns carry the name of the stage they bill ("MATL INSTALL")
// instead of "1st Draw". Hand-built pages follow the geometry of a real one: centered
// headings, amounts a few points off their center.

const DRAWS: DrawName[] = [
  { draw: 1, name: "EXT FRAMES" },
  { draw: 2, name: "MATL INSTALL" },
  { draw: 3, name: "HW INSTALLED" },
  { draw: 4, name: "RETENTION" },
];

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
    pageSizes: pages.map(({ page, width, height, rotation }) => ({ page, width, height, rotation })),
    pages,
    textLength: runs.reduce((sum, r) => sum + r.text.length, 0),
  };
}

// Prices of 1,000.03 and 1,200.00 and 2,000.00 split 15/70/5/10: the first Lot's draws add up
// a cent under its price, which is how a schedule that rounds each draw looks.
type LotRow = [lot: string, price: string, ext: string, matl: string, hw: string, ret: string];
const LOTS: LotRow[] = [
  ["14", "1,000.03", "150.00", "700.02", "50.00", "100.00"],
  ["15", "2,000.00", "300.00", "1,400.00", "100.00", "200.00"],
  ["06", "1,200.00", "180.00", "840.00", "60.00", "120.00"],
];

function lotRuns(rows: LotRow[], firstY: number, phases: string[] = []) {
  return rows.flatMap(([lot, price, ext, matl, hw, ret], index) => {
    const y = firstY - index * 19;
    return [
      run(String(index + 1), 38, y, 4),
      ...(phases[index] ? [run(phases[index], 45, y, 18)] : []),
      run(lot, 68, y, 9),
      run("Plan", 99, y, 17),
      run("4B", 117, y, 10),
      run(price, 188, y, 30),
      run(ext, 285, y, 30),
      run(matl, 348, y, 32),
      run(hw, 420, y, 25),
      run(ret, 488, y, 25),
    ];
  });
}

function headings(withPhase = false) {
  return [
    run("Seq", 28, 547, 13),
    ...(withPhase ? [run("Phase", 45, 547, 25)] : []),
    run("Lot", 78, 547, 11),
    run("Plan", 101, 547, 17),
    run("Price", 188, 547, 17),
    run("EXT. FRAMES", 268, 547, 46),
    run("MATL INSTALL", 332, 547, 49),
    run("HW INSTALLED", 396, 547, 52),
    run("RETENTION", 467, 547, 41),
  ];
}

function schedulePage(
  overrides: { rows?: LotRow[]; extra?: TextRun[]; withPhase?: boolean; printedPhase?: string } = {},
) {
  const rows = overrides.rows ?? LOTS;
  return page([
    run("Exhibit B - Payment Schedule", 397, 761, 110),
    run("Phase:", 247, 677, 25),
    run(overrides.printedPhase ?? "2", 278, 677, 5),
    // The summary of Plans above the table: how many Lots there are and what they come to.
    run("Plan", 331, 705, 17),
    run("Mix", 435, 705, 15),
    run("Price", 492, 705, 20),
    run("Total", 550, 705, 20),
    run("3", 436, 590, 5),
    run("4,200.03", 525, 590, 40),
    ...headings(overrides.withPhase),
    ...lotRuns(rows, 528, overrides.withPhase ? ["MDL", "MDL", "MDL"] : []),
    run("The work authorized by this contract shall be performed under the Terms", 29, 132, 300),
    ...(overrides.extra ?? []),
  ]);
}

function cell(analysis: ReturnType<typeof analyzePaymentScheduleContent>, lot: string, draw: number) {
  return analysis.cells.find((candidate) => candidate.lot === lot && candidate.draw === draw);
}

Deno.test("named columns are numbered with the draws of the Billing Setup", () => {
  const analysis = analyzePaymentScheduleContent(content(schedulePage()), { drawNames: DRAWS });

  assertEquals(analysis.layout, "matrix");
  assertEquals(analysis.cells.length, 12);
  assertEquals(analysis.issues, []);
  assertEquals(analysis.draws, [
    { draw: 1, name: "EXT. FRAMES", costCode: null },
    { draw: 2, name: "MATL INSTALL", costCode: null },
    { draw: 3, name: "HW INSTALLED", costCode: null },
    { draw: 4, name: "RETENTION", costCode: null },
  ]);
  assertEquals(cell(analysis, "14", 1)?.amount, 150);
  assertEquals(cell(analysis, "14", 2)?.amount, 700.02);
  assertEquals(cell(analysis, "15", 2)?.amount, 1400);
  assertEquals(cell(analysis, "06", 4)?.amount, 120);
  // A list has no boxes to fill; neither does this.
  assertEquals(analysis.summaryRows, null);

  // The box is the amount itself: 1,106.71 of Lot 14 starts at x 285.
  const rect = cell(analysis, "14", 1)!.rect;
  assert(Math.abs(rect.x * 612 - (285 - 1.5)) < 0.01);
  assert(rect.y > 0 && rect.y < 1 && rect.w > 0 && rect.h > 0);
});

Deno.test("a draw whose rounding drifts a cent from the price is not a mismatch", () => {
  const analysis = analyzePaymentScheduleContent(content(schedulePage()), { drawNames: DRAWS });

  // Lot 14 splits 1,000.03 into draws that add up to 1,000.02.
  assertEquals(analysis.expectedTotalCents, 420_003);
  assertEquals(analysis.foundTotalCents, 420_002);
  // Three Lots, two cents each at most for four draws.
  assertEquals(analysis.totalToleranceCents, 6);
  assertEquals(analysis.issues, []);
});

Deno.test("the Phase printed above the table is the Phase of every Lot", () => {
  const analysis = analyzePaymentScheduleContent(content(schedulePage()), { drawNames: DRAWS });
  assertEquals(new Set(analysis.cells.map((candidate) => candidate.phase)), new Set(["2"]));
});

Deno.test("a Phase column wins over the Phase printed above", () => {
  const analysis = analyzePaymentScheduleContent(
    content(schedulePage({ withPhase: true })),
    { drawNames: DRAWS },
  );
  assertEquals(new Set(analysis.cells.map((candidate) => candidate.phase)), new Set(["MDL"]));
});

Deno.test("headings match the names whatever their case or punctuation", () => {
  const analysis = analyzePaymentScheduleContent(content(schedulePage()), {
    drawNames: [
      { draw: 1, name: "Ext Frames" },
      { draw: 2, name: "matl  install" },
      { draw: 3, name: "HW-Installed" },
      { draw: 4, name: "Retention" },
    ],
  });
  assertEquals(analysis.cells.length, 12);
});

Deno.test("only the draws of the Billing Setup are read, and what sits under another heading is said", () => {
  // Draw 3 is called something else in this Billing Setup: its column is not a draw.
  const analysis = analyzePaymentScheduleContent(content(schedulePage()), {
    drawNames: [
      { draw: 1, name: "EXT FRAMES" },
      { draw: 2, name: "MATL INSTALL" },
      { draw: 3, name: "HARDWARE" },
      { draw: 4, name: "RETENTION" },
    ],
  });

  assertEquals(analysis.cells.length, 9);
  assertEquals(analysis.cells.some((candidate) => candidate.draw === 3), false);
  const messages = analysis.issues.map((issue) => issue.message);
  assertEquals(
    messages.filter((message) => message.includes("not a draw of the Billing Setup")).length,
    1,
  );
  // Without the third draw the Lots no longer add up to their prices.
  assert(analysis.issues.some((issue) => issue.code === "row_total_mismatch"));
});

Deno.test("draws that miss the price by more than rounding are flagged, with the printed total", () => {
  const analysis = analyzePaymentScheduleContent(
    content(schedulePage({ rows: [LOTS[0], ["15", "2,000.00", "310.00", "1,400.00", "100.00", "200.00"], LOTS[2]] })),
    { drawNames: DRAWS },
  );

  const row = analysis.issues.find((issue) => issue.code === "row_total_mismatch");
  assertEquals(row?.lot, "15");
  assert(analysis.issues.some((issue) => issue.code === "grand_total_mismatch"));
});

Deno.test("the rows of a page without its own heading continue the table", () => {
  const first = schedulePage({ rows: LOTS.slice(0, 2) });
  const second = page([
    run("Page Number 2", 278, 21, 60),
    ...lotRuns(LOTS.slice(2), 700),
  ], 2);
  const analysis = analyzePaymentScheduleContent(content(first, second), { drawNames: DRAWS });

  assertEquals(analysis.cells.length, 12);
  assertEquals(cell(analysis, "06", 3)?.page, 2);
  assertEquals(cell(analysis, "14", 3)?.page, 1);
  // The summary above says 3 Lots, and 3 were read over the two pages.
  assertEquals(analysis.expectedTotalCents, 420_003);
});

Deno.test("a count above the table is not a total unless it is the number of Lots", () => {
  const analysis = analyzePaymentScheduleContent(
    content(schedulePage({ rows: LOTS.slice(0, 2) })),
    { drawNames: DRAWS },
  );
  assertEquals(analysis.expectedTotalCents, null);
  assertEquals(analysis.issues.map((issue) => issue.code), ["missing_total"]);
});

Deno.test("without the names of the draws the schedule is not recognized, and the message says what it needs", () => {
  const withoutNames = assertThrows(
    () => analyzePaymentScheduleContent(content(schedulePage())),
    PaymentScheduleError,
  );
  assertEquals(withoutNames.reason, "unrecognized_layout");
  assertEquals(withoutNames.message, "The Lots and draws of this Payment Schedule could not be found.");

  // Headings that are not the Billing Setup's are not guessed from their position.
  const other = assertThrows(
    () =>
      analyzePaymentScheduleContent(content(schedulePage()), {
        drawNames: [{ draw: 1, name: "FOUNDATION" }, { draw: 2, name: "SLAB" }],
      }),
    PaymentScheduleError,
  );
  assertEquals(other.reason, "unrecognized_layout");
  assert(other.message.includes("FOUNDATION, SLAB"));
  assert(other.message.includes('"1st Draw"'));
});

Deno.test("a name two draws share does not tell either of them", () => {
  assertThrows(
    () =>
      analyzePaymentScheduleContent(content(schedulePage()), {
        drawNames: [
          { draw: 1, name: "EXT FRAMES" },
          { draw: 2, name: "EXT FRAMES" },
          { draw: 3, name: "MATL INSTALL" },
        ],
      }),
    PaymentScheduleError,
  );
});

Deno.test("a Lot or a Phase with a decimal is read whole, not cut at the dot", () => {
  // 12 and 12.1 are different, related Lots; so are Phase 2 and Phase 2.1.
  const rows: LotRow[] = [
    ["12", "1,000.03", "150.00", "700.02", "50.00", "100.00"],
    ["12.1", "2,000.00", "300.00", "1,400.00", "100.00", "200.00"],
    ["13", "1,200.00", "180.00", "840.00", "60.00", "120.00"],
  ];
  const analysis = analyzePaymentScheduleContent(
    content(schedulePage({ rows, printedPhase: "2.1" })),
    { drawNames: DRAWS },
  );

  assertEquals(analysis.issues, []);
  assertEquals(analysis.cells.length, 12);
  assertEquals(new Set(analysis.cells.map((candidate) => candidate.lot)), new Set(["12", "12.1", "13"]));
  assertEquals(new Set(analysis.cells.map((candidate) => candidate.phase)), new Set(["2.1"]));
  assertEquals(cell(analysis, "12", 2)?.amount, 700.02);
  assertEquals(cell(analysis, "12.1", 2)?.amount, 1400);
});
