import { assert, assertEquals } from "@std/assert";
import { analyzePaymentSchedulePdf } from "./paymentScheduleAnalysis.ts";
import { normalizeCodeKey } from "./paymentScheduleTypes.ts";

// Runs the real pipeline against the sample PDFs in
// fixtures/private/payment-schedules (ignored by git: they are real builder
// documents). The tests skip themselves when the folder is not there, so a
// fresh clone and CI stay green. Run with:
//   npm run functions:test --workspace=@valtrimbilling/backend

const FIXTURES = new URL(
  "../../../../../fixtures/private/payment-schedules/",
  import.meta.url,
);

function available(name: string) {
  try {
    return Deno.statSync(new URL(name, FIXTURES)).isFile;
  } catch {
    return false;
  }
}

async function analyze(name: string) {
  return await analyzePaymentSchedulePdf(
    await Deno.readFile(new URL(name, FIXTURES)),
  );
}

function cell(
  analysis: Awaited<ReturnType<typeof analyze>>,
  lot: string,
  draw: number,
) {
  return analysis.cells.find((candidate) =>
    normalizeCodeKey(candidate.lot) === normalizeCodeKey(lot) &&
    candidate.draw === draw
  );
}

const MATRIX_1 = "Example Payment Schedule 1 Template.pdf";
const LIST = "Example Payment Schedule 2 Template.pdf";
const MATRIX_3 = "Example Payment Schedule 3 Template.pdf";

Deno.test({
  name: "fixture matrix 1: Phase 003, Lots 14 to 27, five draws",
  ignore: !available(MATRIX_1),
  async fn() {
    const analysis = await analyze(MATRIX_1);

    assertEquals(analysis.layout, "matrix");
    assertEquals(analysis.cells.length, 14 * 5);
    assertEquals(analysis.issues, []);
    assertEquals(analysis.expectedTotalCents, 7_026_840);
    assertEquals(analysis.foundTotalCents, 7_026_840);
    assertEquals(analysis.draws.map((draw) => draw.draw), [1, 2, 3, 4, 5]);
    assertEquals(analysis.draws[1].costCode, "480052");
    assertEquals(analysis.draws[1].name, "Trim Complete -Fini");

    const lot23 = cell(analysis, "0023", 2)!;
    assertEquals(lot23.phase, "003");
    assertEquals(lot23.lot, "0023");
    assertEquals(lot23.amount, 1611.9);
    assertEquals(cell(analysis, "0014", 1)!.amount, 1929.04);
    assertEquals(cell(analysis, "0027", 5)!.amount, 537.3);
    assertEquals(new Set(analysis.cells.map((c) => c.page)), new Set([1]));
  },
});

Deno.test({
  name: "fixture matrices: the Previously Invoiced and This Request boxes sit in the blank rows",
  ignore: !available(MATRIX_1) || !available(MATRIX_3),
  async fn() {
    for (const file of [MATRIX_1, MATRIX_3]) {
      const { summaryRows, pageSizes } = await analyze(file);
      assert(summaryRows, file);
      const { height } = pageSizes[0];

      for (const row of [summaryRows.previouslyInvoiced, summaryRows.thisRequest]) {
        assertEquals(row.map((target) => target.draw), [1, 2, 3, 4, 5], file);
        for (const target of row) {
          assertEquals(target.page, 1);
          assert(target.rect.w * 612 > 25 && target.rect.w * 612 < 50, file);
          assert(target.rect.x + target.rect.w <= 1 && target.rect.y + target.rect.h <= 1, file);
        }
      }
      assert(summaryRows.thisRequest[0].rect.y > summaryRows.previouslyInvoiced[0].rect.y, file);
      assert(height > 0);
    }

    // Example 1: the people who filled it by hand typed "This Request" values for
    // draws 2 and 3 in these cells (PDF points: x 215-300, y 378-394 from the bottom).
    const { summaryRows, pageSizes } = await analyze(MATRIX_1);
    const { width, height: pageHeight } = pageSizes[0];
    const second = summaryRows!.thisRequest[1].rect;
    const x0 = second.x * width;
    const x1 = (second.x + second.w) * width;
    const yTop = pageHeight - second.y * pageHeight;
    const yBottom = pageHeight - (second.y + second.h) * pageHeight;
    assert(x0 >= 213 && x1 <= 262, `x ${x0}-${x1}`);
    assert(yBottom <= 380 && yTop >= 376, `y ${yBottom}-${yTop}`);
  },
});

Deno.test({
  name: "fixture list: a list has no summary rows",
  ignore: !available(LIST),
  async fn() {
    assertEquals((await analyze(LIST)).summaryRows, null);
  },
});

Deno.test({
  name: "fixture matrix 1: the Lot 23 to 27 draw 2 and 3 cells form a block",
  ignore: !available(MATRIX_1),
  async fn() {
    const analysis = await analyze(MATRIX_1);
    // The package in the reference image bills draws 2 and 3 of Lots 23 to 27.
    const rects = ["0023", "0024", "0025", "0026", "0027"].flatMap((lot) => [
      cell(analysis, lot, 2)!.rect,
      cell(analysis, lot, 3)!.rect,
    ]);
    for (const rect of rects) {
      assert(rect.x > 0 && rect.y > 0 && rect.w > 0 && rect.h > 0);
      assert(rect.x + rect.w <= 1 && rect.y + rect.h <= 1);
    }
    // Same row, same y; draw 3 sits to the right of draw 2.
    const lot23Draw2 = cell(analysis, "0023", 2)!.rect;
    const lot23Draw3 = cell(analysis, "0023", 3)!.rect;
    assert(Math.abs(lot23Draw2.y - lot23Draw3.y) < 0.002);
    assert(lot23Draw3.x > lot23Draw2.x);
    // Lot 24 is the next row down.
    assert(cell(analysis, "0024", 2)!.rect.y > lot23Draw2.y);
  },
});

Deno.test({
  name: "fixture matrix 3: Phase MDL, Lots 1 to 10, five draws",
  ignore: !available(MATRIX_3),
  async fn() {
    const analysis = await analyze(MATRIX_3);

    assertEquals(analysis.layout, "matrix");
    assertEquals(analysis.cells.length, 10 * 5);
    assertEquals(analysis.issues, []);
    assertEquals(analysis.expectedTotalCents, 4_493_400);
    assertEquals(analysis.foundTotalCents, 4_493_400);
    assertEquals(cell(analysis, "0001", 1)!.phase, "MDL");
    assertEquals(cell(analysis, "0010", 4)!.amount, 449.34);
    assertEquals(cell(analysis, "10", 2)!.amount, 1348.02);
  },
});

Deno.test({
  name: "fixture list: a Payment Schedule with a row per Lot and draw over four pages",
  ignore: !available(LIST),
  async fn() {
    const analysis = await analyze(LIST);

    assertEquals(analysis.layout, "line_items");
    assertEquals(analysis.cells.length, 25 * 4);
    assertEquals(analysis.issues, []);
    assertEquals(analysis.expectedTotalCents, 19_812_100);
    assertEquals(analysis.foundTotalCents, 19_812_100);
    assertEquals(analysis.draws.map((draw) => draw.draw), [1, 2, 3, 4]);
    assertEquals(analysis.draws[1].name, "Trim Complete");
    assertEquals(analysis.pageCount, 4);

    assertEquals(cell(analysis, "01", 1)!.amount, 1735.05);
    assertEquals(cell(analysis, "1", 2)!.amount, 7518.55);
    assertEquals(cell(analysis, "25", 4)!.phase, null);
    assertEquals(cell(analysis, "25", 4)!.page, 4);

    // Lot 08 is split: draw 1 closes page 1 and draws 2 to 4 open page 2.
    assertEquals(cell(analysis, "08", 1)!.page, 1);
    assertEquals(cell(analysis, "08", 2)!.page, 2);
    assertEquals(cell(analysis, "22", 3)!.page, 3);
    assertEquals(cell(analysis, "22", 4)!.page, 4);

    // The highlight covers the whole row, not only the amount.
    const row = cell(analysis, "01", 1)!.rect;
    assert(row.x < 0.1 && row.x + row.w > 0.9);
  },
});
