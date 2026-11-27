import { STALE_ANALYZING_MS } from "./releaseAnalysisState.ts";

// Decides what a request to analyze a Purchase Order should do, given the analysis
// row that may already exist for its document. Same idea as the Release and
// Payment Schedule analyses, with the statuses of a Purchase Order: there is no
// confirmation step, because the comparison with the system is always live.
//
//   no row                      -> create it and analyze
//   analyzing, recently started -> another request is running: do not start a second
//   analyzing, stale            -> the earlier run died (timeout, crash): analyze again
//   failed                      -> analyze again
//   analyzed / not_option_po    -> return it unless the caller forces a new analysis

export type PurchaseOrderStatus =
  | "analyzing"
  | "analyzed"
  | "failed"
  | "not_option_po";

export type PurchaseOrderDecision =
  | "create"
  | "reanalyze"
  | "return_existing"
  | "in_progress";

export function decidePurchaseOrderAnalysis(
  existing: { status: PurchaseOrderStatus; updatedAt: string } | null,
  options: { force: boolean; now: number },
): PurchaseOrderDecision {
  if (!existing) return "create";

  switch (existing.status) {
    case "analyzing": {
      const startedAt = Date.parse(existing.updatedAt);
      return Number.isFinite(startedAt) &&
          options.now - startedAt < STALE_ANALYZING_MS
        ? "in_progress"
        : "reanalyze";
    }
    case "failed":
      return "reanalyze";
    default:
      return options.force ? "reanalyze" : "return_existing";
  }
}
