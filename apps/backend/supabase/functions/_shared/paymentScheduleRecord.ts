import type { PaymentScheduleAnalysis } from "./paymentScheduleAnalysis.ts";
import { centsToDollars } from "./paymentScheduleTypes.ts";

// The columns of a payment_schedule_templates row that an analysis fills in.
// Pure, so what reaches the database is covered by tests. Only cells, draws and
// short validation messages are kept: the extracted text never is.

export function templateAnalysisColumns(analysis: PaymentScheduleAnalysis) {
  return {
    layout: analysis.layout,
    detection_method: analysis.detectionMethod,
    page_count: analysis.pageCount,
    page_sizes: analysis.pageSizes,
    detected_cells: analysis.cells,
    analysis: {
      draws: analysis.draws,
      issues: analysis.issues,
      summaryRows: analysis.summaryRows,
      expectedTotal: analysis.expectedTotalCents === null
        ? null
        : centsToDollars(analysis.expectedTotalCents),
      foundTotal: centsToDollars(analysis.foundTotalCents),
    },
    status: "needs_review" as const,
    error: null,
    analyzed_at: new Date().toISOString(),
  };
}
