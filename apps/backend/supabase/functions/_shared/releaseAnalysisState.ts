// Decides what a request to analyze a Release document should do, given the
// template row that may already exist for it. Keeping the rule pure makes the
// endpoint idempotent in a way that is easy to test:
//
//   no row                      -> create it and analyze
//   analyzing, recently started -> another request is running: do not start a second
//   analyzing, stale            -> the earlier run died (timeout, crash): analyze again
//   failed                      -> analyze again
//   needs_review                -> return it unless the caller forces a new analysis
//   confirmed / superseded      -> return it; analysis never overwrites a confirmed mapping

export const STALE_ANALYZING_MS = 3 * 60 * 1000;

export type AnalysisStatus =
  | "analyzing"
  | "needs_review"
  | "confirmed"
  | "superseded"
  | "failed";

export type AnalysisDecision =
  | "create"
  | "reanalyze"
  | "return_existing"
  | "in_progress";

export function decideAnalysis(
  existing: { status: AnalysisStatus; updatedAt: string } | null,
  options: { force: boolean; now: number },
): AnalysisDecision {
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
    case "needs_review":
      return options.force ? "reanalyze" : "return_existing";
    default:
      return "return_existing";
  }
}
