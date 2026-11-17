import { assertEquals } from "@std/assert";
import { decideAnalysis, STALE_ANALYZING_MS } from "./releaseAnalysisState.ts";

const now = Date.parse("2026-10-07T12:00:00Z");
const at = (msAgo: number) => new Date(now - msAgo).toISOString();

Deno.test("a document without a template is created and analyzed", () => {
  assertEquals(decideAnalysis(null, { force: false, now }), "create");
});

Deno.test("a run that just started blocks a second request", () => {
  assertEquals(
    decideAnalysis({ status: "analyzing", updatedAt: at(5_000) }, { force: false, now }),
    "in_progress",
  );
  assertEquals(
    decideAnalysis({ status: "analyzing", updatedAt: at(5_000) }, { force: true, now }),
    "in_progress",
  );
});

Deno.test("a run that stopped answering is analyzed again", () => {
  assertEquals(
    decideAnalysis(
      { status: "analyzing", updatedAt: at(STALE_ANALYZING_MS + 1) },
      { force: false, now },
    ),
    "reanalyze",
  );
  assertEquals(
    decideAnalysis({ status: "analyzing", updatedAt: "garbage" }, { force: false, now }),
    "reanalyze",
  );
});

Deno.test("a failed analysis can be retried", () => {
  assertEquals(
    decideAnalysis({ status: "failed", updatedAt: at(1) }, { force: false, now }),
    "reanalyze",
  );
});

Deno.test("a template waiting for review is reused unless the caller forces a new analysis", () => {
  assertEquals(
    decideAnalysis({ status: "needs_review", updatedAt: at(1) }, { force: false, now }),
    "return_existing",
  );
  assertEquals(
    decideAnalysis({ status: "needs_review", updatedAt: at(1) }, { force: true, now }),
    "reanalyze",
  );
});

Deno.test("a confirmed or superseded template is never overwritten, even when forced", () => {
  for (const status of ["confirmed", "superseded"] as const) {
    assertEquals(
      decideAnalysis({ status, updatedAt: at(1) }, { force: true, now }),
      "return_existing",
    );
  }
});
