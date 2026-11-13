import { centsToDollars } from "./paymentScheduleTypes.ts";
import { normalizeOptionCode } from "./purchaseOrderNormalize.ts";
import {
  chooseOptionId,
  type HeaderAliases,
  type HeaderResolution,
  type JobContext,
  type JobPlanOption,
  lineKeys,
  resolveHeader,
} from "./purchaseOrderResolve.ts";
import type {
  ParsedPurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderWorkOrder,
} from "./purchaseOrderTypes.ts";

// What reaches the database after an analysis. Pure, so the shape the
// save_purchase_order_analysis function receives is covered by tests. The PDF's
// text is never stored: only the option lines, the printed header values and a few
// short validation messages.

const SHORT = 100;
const CODE = 60;

/** Cuts a printed value to its column, so one odd PDF cannot fail the whole save. */
function clip(value: string | null, max: number) {
  return value === null ? null : value.slice(0, max);
}

export interface LineRowInput {
  workOrder: PurchaseOrderWorkOrder;
  line: PurchaseOrderLine;
  resolution: HeaderResolution;
  // Set only when the code alone does not identify the option (see chooseOptionId).
  planOptionId: number | null;
}

export function analysisColumns(
  parsed: ParsedPurchaseOrder,
  pageCount: number,
) {
  return {
    parser: parsed.parser,
    page_count: pageCount,
    issues: parsed.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.page === undefined ? {} : { page: issue.page }),
      ...(issue.workOrderNo === undefined
        ? {}
        : { workOrderNo: issue.workOrderNo }),
      ...(issue.referenceNo === undefined
        ? {}
        : { referenceNo: issue.referenceNo }),
    })),
  };
}

export function lineRow(input: LineRowInput) {
  const { workOrder, line, resolution } = input;
  const keys = lineKeys(workOrder);

  return {
    work_order_no: clip(workOrder.workOrderNo, CODE),
    page: line.page,
    lot_raw: clip(workOrder.lotRaw, SHORT),
    phase_raw: clip(workOrder.phaseRaw, SHORT),
    plan_raw: clip(workOrder.planRaw, SHORT),
    elevation_raw: clip(workOrder.elevationRaw, SHORT),
    tract_raw: clip(workOrder.tractRaw, SHORT),
    phase_key: clip(keys.phaseKey, SHORT),
    lot_key: clip(keys.lotKey, SHORT),
    option_code_raw: clip(line.optionCodeRaw, CODE),
    option_code_key: clip(normalizeOptionCode(line.optionCodeRaw), CODE),
    reference_no: clip(line.referenceNo, CODE),
    po_date: line.date,
    revised_on: line.revisedOn,
    quantity: line.quantity,
    unit_price: centsToDollars(line.unitPriceCents),
    total: centsToDollars(line.totalCents),
    description_lines: line.descriptionLines.map((text) => text.slice(0, 300)),
    previous_cost: line.previousCostCents === null
      ? null
      : centsToDollars(line.previousCostCents),
    lot_id: resolution.lotId,
    phase_id: resolution.phaseId,
    plan_id: resolution.planId,
    header_status: resolution.status,
    header_match: resolution.detail,
    plan_option_id: input.planOptionId,
  };
}

export interface AnalysisRecordInput {
  parsed: ParsedPurchaseOrder;
  pageCount: number;
  // The Job's Phases, Plans and Lots, its learned aliases and its active options.
  context: JobContext;
  aliases: HeaderAliases;
  options: JobPlanOption[];
}

/** Everything save_purchase_order_analysis needs: the analysis columns and its lines. */
export function buildAnalysisRecord(input: AnalysisRecordInput) {
  const rows = input.parsed.workOrders.flatMap((workOrder) => {
    const resolution = resolveHeader(workOrder, input.context, input.aliases);
    return workOrder.lines.map((line) =>
      lineRow({
        workOrder,
        line,
        resolution,
        planOptionId: resolution.planId === null
          ? null
          : chooseOptionId(line, resolution.planId, input.options),
      })
    );
  });
  return { columns: analysisColumns(input.parsed, input.pageCount), rows };
}
