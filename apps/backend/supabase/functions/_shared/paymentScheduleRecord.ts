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
      // Rounding the schedule's own draws carry, so a cent apart is not a mismatch.
      totalTolerance: centsToDollars(analysis.totalToleranceCents ?? 0),
      // Utility amounts printed per Lot, offered to the reviewer like the draw cells.
      ...(analysis.utilityCells?.length ? { utilityCells: analysis.utilityCells } : {}),
      // Only for a schedule the AI read: the reviewer is told so, with what was checked.
      ...(analysis.ai
        ? {
          ai: {
            model: analysis.ai.model,
            notes: analysis.ai.notes,
            lotsChecked: analysis.ai.lotsChecked,
            lotsMatchingPrice: analysis.ai.lotsMatchingPrice,
            utility: analysis.ai.utility && {
              count: analysis.ai.utility.count,
              matching: analysis.ai.utility.matching,
              total: centsToDollars(analysis.ai.utility.totalCents),
            },
          },
        }
        : {}),
    },
    status: "needs_review" as const,
    error: null,
    analyzed_at: new Date().toISOString(),
  };
}
