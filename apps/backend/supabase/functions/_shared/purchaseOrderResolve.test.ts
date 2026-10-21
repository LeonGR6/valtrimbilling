import { assertEquals } from "@std/assert";
import { buildAnalysisRecord, lineRow } from "./purchaseOrderRecord.ts";
import {
  aliasesToLearn,
  chooseOptionId,
  groupLinesByHeader,
  type JobContext,
  resolveHeader,
} from "./purchaseOrderResolve.ts";
import { decidePurchaseOrderAnalysis } from "./purchaseOrderState.ts";
import type {
  ParsedPurchaseOrder,
  PurchaseOrderWorkOrder,
} from "./purchaseOrderTypes.ts";

// Made-up Job shaped like the real one: a Phase named MODELS, Plans that carry
// their elevation ("4B"), and a Phase that exists in two buildings.
const context: JobContext = {
  phases: [
    { id: 5, code: "MODELS" },
    { id: 1, code: "1" },
    { id: 2, code: "1" },
  ],
  plans: [
    { id: 12, code: "4B" },
    { id: 8, code: "2A" },
    { id: 7, code: "1B" },
  ],
  lots: [
    { id: 27, phaseId: 5, planId: 12, lotNumber: "27" },
    { id: 28, phaseId: 5, planId: 8, lotNumber: "28" },
    // Lot 3 exists in both buildings of Phase 1, with different Plans.
    { id: 31, phaseId: 1, planId: 12, lotNumber: "3" },
    { id: 32, phaseId: 2, planId: 8, lotNumber: "3" },
  ],
};

const header = (
  lotRaw: string | null,
  phaseRaw: string | null,
  planRaw: string | null,
  elevationRaw: string | null,
) => ({ lotRaw, phaseRaw, planRaw, elevationRaw });

Deno.test("Model, Models and MDL all find the Phase MODELS", () => {
  const models = resolveHeader(header("27", "Models", "4", "B"), context);
  assertEquals(models.status, "resolved");
  assertEquals([models.lotId, models.phaseId, models.planId], [27, 5, 12]);

  // An abbreviation is only suggested until a reviewer confirms it.
  assertEquals(
    resolveHeader(header("27", "MDL", "4", "B"), context).status,
    "suggested",
  );
  assertEquals(
    resolveHeader(header("27", "Model", "4", "B"), context).status,
    "resolved",
  );
});

Deno.test("a learned alias settles an abbreviation", () => {
  const result = resolveHeader(header("27", "MDL", "4", "B"), context, {
    phase: new Map([["MDL", "MODELS"]]),
  });
  assertEquals(result.status, "resolved");
  assertEquals(result.lotId, 27);
});

Deno.test("the printed Plan is checked against the Lot's Plan", () => {
  // Lot 28 is Plan 2A in the system.
  const mismatch = resolveHeader(header("28", "MODELS", "4", "B"), context);
  assertEquals(mismatch.status, "plan_mismatch");
  // The Lot is still found, so its options can be compared.
  assertEquals([mismatch.lotId, mismatch.planId], [28, 8]);
  assertEquals(mismatch.detail, {
    printedPlan: "4",
    printedElevation: "B",
    lotPlan: "2A",
  });

  const unknownPlan = resolveHeader(header("28", "MODELS", "9", "Z"), context);
  assertEquals(unknownPlan.status, "plan_mismatch");

  // No Plan printed: nothing to verify.
  assertEquals(
    resolveHeader(header("28", "MODELS", null, null), context).status,
    "resolved",
  );
});

Deno.test("a Lot or Phase that does not exist is reported, not guessed", () => {
  assertEquals(
    resolveHeader(header("99", "MODELS", "4", "B"), context).status,
    "lot_not_found",
  );
  assertEquals(
    resolveHeader(header("27", "Garden", "4", "B"), context).status,
    "phase_not_found",
  );
  assertEquals(
    resolveHeader(header(null, "MODELS", "4", "B"), context).status,
    "lot_not_found",
  );
});

Deno.test("a Lot number repeated across buildings is told apart by its Plan", () => {
  // Phase 1 has two buildings, and Lot 3 is in both.
  const first = resolveHeader(header("3", "Phase 1", "4", "B"), context);
  assertEquals(first.status, "resolved");
  assertEquals(first.lotId, 31);

  const second = resolveHeader(header("3", "1", "2", "A"), context);
  assertEquals(second.status, "resolved");
  assertEquals(second.lotId, 32);

  // Without a Plan to tell them apart it is the reviewer's call.
  const unknown = resolveHeader(header("3", "1", null, null), context);
  assertEquals(unknown.status, "ambiguous");
  assertEquals(unknown.lotId, null);
});

Deno.test("options with the same code are told apart by description", () => {
  const options = [
    {
      id: 1,
      planId: 12,
      code: "2CAB3033",
      name: "Add Upper Laundry Cabinet with Shelf and Pole",
      description: null,
    },
    {
      id: 2,
      planId: 12,
      code: "2CAB3033",
      name: "Replace Pantry Door Hardware",
      description: null,
    },
    {
      id: 3,
      planId: 12,
      code: "2FIN5006",
      name: "Add Half Size Lower Second Shelf",
      description: null,
    },
  ];
  const line = (code: string, text: string[]) => ({
    optionCodeRaw: code,
    descriptionLines: text,
  });

  assertEquals(
    chooseOptionId(
      line("2CAB3033", ["Add Upper Laundry Cabinet with Shelf and Pole"]),
      12,
      options,
    ),
    1,
  );
  // Unclear description: no choice is made for the reviewer.
  assertEquals(
    chooseOptionId(line("2CAB3033", ["Something else entirely"]), 12, options),
    null,
  );
  // One option with the code needs no choice: the database finds it.
  assertEquals(
    chooseOptionId(line("2FIN5006", ["Anything"]), 12, options),
    null,
  );
  // Another Plan's options are not candidates.
  assertEquals(
    chooseOptionId(
      line("2CAB3033", ["Add Upper Laundry Cabinet with Shelf and Pole"]),
      8,
      options,
    ),
    null,
  );
});

const workOrder: PurchaseOrderWorkOrder = {
  workOrderNo: "0813MDLH27-13325-19",
  page: 1,
  lotRaw: "27",
  phaseRaw: "MDL",
  planRaw: "4",
  elevationRaw: "B",
  tractRaw: "84681",
  declaredTotalCents: 8100,
  lines: [{
    page: 1,
    optionCodeRaw: "2FIN-5006",
    referenceNo: "0004617537",
    date: "2026-08-13",
    revisedOn: "2026-09-02",
    quantity: 1,
    unitPriceCents: -8100,
    totalCents: -8100,
    descriptionLines: ["Add Half Size Shelf", "Bedroom 3"],
    previousCostCents: 0,
  }],
};

Deno.test("a stored line carries dollars, keys and how its header matched", () => {
  const resolution = resolveHeader(workOrder, context);
  const row = lineRow({
    workOrder,
    line: workOrder.lines[0],
    resolution,
    planOptionId: null,
  });

  assertEquals(row.unit_price, -81);
  assertEquals(row.total, -81);
  assertEquals(row.previous_cost, 0);
  assertEquals(row.option_code_raw, "2FIN-5006");
  assertEquals(row.option_code_key, "2FIN5006");
  assertEquals(row.phase_key, "MDL");
  assertEquals(row.lot_key, "27");
  assertEquals(row.lot_id, 27);
  assertEquals(row.plan_id, 12);
  assertEquals(row.header_status, "suggested");
  assertEquals(row.description_lines, ["Add Half Size Shelf", "Bedroom 3"]);
});

Deno.test("an over-long printed value is cut instead of failing the save", () => {
  const long = { ...workOrder, lotRaw: "x".repeat(500) };
  const row = lineRow({
    workOrder: long,
    line: long.lines[0],
    resolution: resolveHeader(long, context),
    planOptionId: null,
  });
  assertEquals(row.lot_raw?.length, 100);
});

Deno.test("the analysis record holds the columns and one row per line", () => {
  const parsed: ParsedPurchaseOrder = {
    parser: "olson",
    workOrders: [workOrder],
    issues: [{
      code: "no_lines",
      message: "A notice has no option lines.",
      page: 2,
      workOrderNo: "WO-9",
    }],
  };
  const record = buildAnalysisRecord({
    parsed,
    pageCount: 3,
    context,
    aliases: {},
    options: [],
  });

  assertEquals(record.columns, {
    parser: "olson",
    page_count: 3,
    issues: [{
      code: "no_lines",
      message: "A notice has no option lines.",
      page: 2,
      workOrderNo: "WO-9",
    }],
  });
  assertEquals(record.rows.length, 1);
  assertEquals(record.rows[0].lot_id, 27);
});

Deno.test("what a request does depends on the analysis it finds", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const recent = "2026-10-21T11:59:00Z";
  const stale = "2026-10-21T11:00:00Z";

  assertEquals(
    decidePurchaseOrderAnalysis(null, { force: false, now }),
    "create",
  );
  assertEquals(
    decidePurchaseOrderAnalysis({ status: "analyzing", updatedAt: recent }, {
      force: true,
      now,
    }),
    "in_progress",
  );
  assertEquals(
    decidePurchaseOrderAnalysis({ status: "analyzing", updatedAt: stale }, {
      force: false,
      now,
    }),
    "reanalyze",
  );
  assertEquals(
    decidePurchaseOrderAnalysis({ status: "failed", updatedAt: recent }, {
      force: false,
      now,
    }),
    "reanalyze",
  );
  for (const status of ["analyzed", "not_option_po"] as const) {
    assertEquals(
      decidePurchaseOrderAnalysis({ status, updatedAt: recent }, {
        force: false,
        now,
      }),
      "return_existing",
    );
    assertEquals(
      decidePurchaseOrderAnalysis({ status, updatedAt: recent }, {
        force: true,
        now,
      }),
      "reanalyze",
    );
  }
});

Deno.test("confirming a suggested header teaches the names it was matched by", () => {
  const lot = context.lots[0];
  assertEquals(
    aliasesToLearn(
      { lotRaw: "27", phaseRaw: "MDL", planRaw: "4", elevationRaw: "B" },
      lot,
      context,
    ),
    [{ kind: "phase", rawKey: "MDL", targetKey: "MODELS" }],
  );

  // Nothing to learn when the names already matched.
  assertEquals(
    aliasesToLearn(
      { lotRaw: "27", phaseRaw: "Models", planRaw: "4", elevationRaw: "B" },
      lot,
      context,
    ),
    [],
  );

  // The system names the Plan without its elevation: "4B" stands for "4".
  const plain: JobContext = {
    ...context,
    plans: [{ id: 12, code: "4" }],
  };
  assertEquals(
    aliasesToLearn(
      { lotRaw: "27", phaseRaw: "MODELS", planRaw: "4", elevationRaw: "B" },
      lot,
      plain,
    ),
    [{ kind: "plan", rawKey: "4B", targetKey: "4" }],
  );

  // And the learned name settles the header next time.
  const again = resolveHeader(
    { lotRaw: "27", phaseRaw: "MODELS", planRaw: "4", elevationRaw: "B" },
    plain,
    { plan: new Map([["4B", "4"]]) },
  );
  assertEquals(again.status, "resolved");
});

Deno.test("lines of one work order are matched together", () => {
  const line = (id: number, lot: string, plan: string) => ({
    id,
    lot_raw: lot,
    phase_raw: "MDL",
    plan_raw: plan,
    elevation_raw: "B",
  });
  const groups = groupLinesByHeader([
    line(1, "27", "4"),
    line(2, "27", "4"),
    line(3, "28", "2"),
  ]);
  assertEquals(groups.map((group) => group.ids), [[1, 2], [3]]);
  assertEquals(groups[0].header.lotRaw, "27");
});
