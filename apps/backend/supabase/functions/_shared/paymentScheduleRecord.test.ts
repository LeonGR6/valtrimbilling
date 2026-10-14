import { assertEquals } from "@std/assert";
import type { PaymentScheduleAnalysis } from "./paymentScheduleAnalysis.ts";
import { templateAnalysisColumns } from "./paymentScheduleRecord.ts";

const analysis: PaymentScheduleAnalysis = {
  layout: "matrix",
  draws: [{ draw: 1, name: "Frames", costCode: "480051" }],
  cells: [{
    phase: "003",
    lot: "0014",
    draw: 1,
    amount: 1929.04,
    page: 1,
    rect: { x: 0.1, y: 0.2, w: 0.05, h: 0.01 },
  }],
  issues: [{ code: "missing_total", message: "No Total Contract row was found." }],
  summaryRows: null,
  expectedTotalCents: null,
  foundTotalCents: 192_904,
  detectionMethod: "text_layer",
  pageCount: 1,
  pageSizes: [{ page: 1, width: 612, height: 1008, rotation: 0 }],
};

Deno.test("an analysis becomes a needs_review template with dollars, not cents", () => {
  const columns = templateAnalysisColumns(analysis);

  assertEquals(columns.status, "needs_review");
  assertEquals(columns.error, null);
  assertEquals(columns.layout, "matrix");
  assertEquals(columns.detection_method, "text_layer");
  assertEquals(columns.page_count, 1);
  assertEquals(columns.detected_cells, analysis.cells);
  assertEquals(columns.analysis, {
    draws: analysis.draws,
    issues: analysis.issues,
    summaryRows: null,
    expectedTotal: null,
    foundTotal: 1929.04,
  });
  assertEquals(Number.isNaN(Date.parse(columns.analyzed_at)), false);
});

Deno.test("a printed total is stored in dollars", () => {
  const columns = templateAnalysisColumns({ ...analysis, expectedTotalCents: 7_026_840 });
  assertEquals(columns.analysis.expectedTotal, 70268.4);
});

Deno.test("the summary rows are stored with the analysis so the review can show them", () => {
  const summaryRows = {
    previouslyInvoiced: [{ draw: 1, page: 1, rect: { x: 0.3, y: 0.4, w: 0.05, h: 0.01 } }],
    thisRequest: [{ draw: 1, page: 1, rect: { x: 0.3, y: 0.42, w: 0.05, h: 0.01 } }],
  };
  assertEquals(templateAnalysisColumns({ ...analysis, summaryRows }).analysis.summaryRows, summaryRows);
});
