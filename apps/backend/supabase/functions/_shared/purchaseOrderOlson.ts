import { groupRows, parseMoneyCents } from "./paymentScheduleTypes.ts";
import type {
  ParsedPurchaseOrder,
  PurchaseOrderIssue,
  PurchaseOrderLine,
  PurchaseOrderWorkOrder,
} from "./purchaseOrderTypes.ts";
import type { PageContent } from "./releaseTypes.ts";

// Parser for The Olson Company "Vendor Notice". Every notice is its own
// document: each says "Page 1 of 1" even when several are joined in one PDF, and
// one notice can run over more than one page. So notices are split by the
// "Vendor Notice" title, never by page.
//
//   Vendor Notice
//   Vendor: ValTrim Inc.            Work Order: 0813MDLH27-13325-19
//   Lot/Unit: 27  Phase: MDL  Plan: 4  Tract: 84681  Elevation: B
//   Date       Option    Reference#   Quantity  Unit Price  Total
//   R E V I S I O N
//   8/13/2026  2FIN5006  0004617537   1         $81.00      $81.00
//   Revised by Sharon Tooman - Bldr Super
//   Add Half Size Lower Second Shelf and Pole at Wardrobe     <- description
//   Bedroom 3
//   Stage: 4
//   R E V I S E D
//   Revised on 9/2/2026. WO:... Cost has changed from $0.00 to $81.00.
//   $81.00                                                     <- work order total
//
// Rows are read by what they say (labels, a date followed by a code, an amount),
// not by column position, so a shifted table still reads. Negative amounts are
// printed in parentheses: ($14.00).

const MONEY = String.raw`\(?-?\$?[\d,]+\.\d{2}\)?`;
const MONEY_ONLY = new RegExp(`^${MONEY}$`, "u");
const LINE_ROW = new RegExp(
  String
    .raw`^(\d{1,2}/\d{1,2}/\d{4})\s+([A-Za-z0-9][A-Za-z0-9-]*)\s+(\d{4,})\s+(\d+(?:\.\d+)?)\s+(${MONEY})\s+(${MONEY})$`,
  "u",
);
const HEADER_LABEL = /(Lot\/Unit|Phase|Plan|Tract|Elevation):/gu;
const WORK_ORDER = /Work Order:\s*([A-Za-z0-9-]+)/u;
const REVISED_ON = /Revised on (\d{1,2}\/\d{1,2}\/\d{4})/u;
const COST_CHANGED = new RegExp(
  `Cost has changed from (${MONEY}) to (${MONEY})`,
  "u",
);
const REVISED_BY = /\s*Revised by\b.*$/u;
const TITLE = /^Vendor Notice$/iu;
const DESCRIPTION_STOP =
  /^(?:Stage:|R E V I S|Revised on|Pursuant to|Order submitted)/u;

/** Cents for a printed amount: "$1,126.00", "($14.00)" and "-$14.00" are accepted. */
export function parseSignedCents(text: string): number | null {
  const value = text.trim();
  if (!MONEY_ONLY.test(value)) return null;
  const negative = value.startsWith("(") || value.includes("-");
  const cents = parseMoneyCents(value.replace(/[()-]/gu, ""));
  if (cents === null) return null;
  return negative ? -cents : cents;
}

/** "8/13/2026" -> "2026-08-13"; null when it is not a real date. */
export function toIsoDate(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(text.trim());
  if (!match) return null;
  const [month, day, year] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
}

function rowTexts(page: PageContent) {
  return groupRows(page.runs)
    .map((row) =>
      row.runs.map((run) => run.text.trim()).filter((text) => text !== "")
        .join(" ").replace(/\s+/gu, " ").trim()
    )
    .filter((text) => text !== "");
}

/** True when the PDF is made of Olson Vendor Notices. */
export function isOlsonVendorNotice(pages: PageContent[]) {
  let title = false;
  let workOrder = false;
  let lot = false;
  for (const page of pages) {
    for (const text of rowTexts(page)) {
      if (TITLE.test(text)) title = true;
      if (WORK_ORDER.test(text)) workOrder = true;
      if (text.includes("Lot/Unit:")) lot = true;
    }
  }
  return title && workOrder && lot;
}

function readHeaderLabels(text: string) {
  const labels = [...text.matchAll(HEADER_LABEL)];
  const values = new Map<string, string>();
  labels.forEach((label, index) => {
    const start = (label.index ?? 0) + label[0].length;
    const end = labels[index + 1]?.index ?? text.length;
    const value = text.slice(start, end).trim();
    if (value !== "") values.set(label[1], value);
  });
  return values;
}

function emptyWorkOrder(page: number): PurchaseOrderWorkOrder {
  return {
    workOrderNo: "",
    page,
    lotRaw: null,
    phaseRaw: null,
    planRaw: null,
    elevationRaw: null,
    tractRaw: null,
    declaredTotalCents: null,
    lines: [],
  };
}

function checkWorkOrder(
  workOrder: PurchaseOrderWorkOrder,
  issues: PurchaseOrderIssue[],
) {
  const where = {
    page: workOrder.page,
    workOrderNo: workOrder.workOrderNo || undefined,
  };

  if (
    workOrder.workOrderNo === "" || workOrder.lotRaw === null ||
    workOrder.phaseRaw === null || workOrder.planRaw === null
  ) {
    issues.push({
      ...where,
      code: "missing_header",
      message:
        "A notice is missing its Work Order, Lot, Phase or Plan. Review it before using it.",
    });
  }

  if (workOrder.lines.length === 0) {
    issues.push({
      ...where,
      code: "no_lines",
      message: "A notice has no option lines.",
    });
    return;
  }

  const seen = new Set<string>();
  let sum = 0;
  for (const line of workOrder.lines) {
    sum += line.totalCents;

    if (Math.round(line.quantity * line.unitPriceCents) !== line.totalCents) {
      issues.push({
        ...where,
        code: "line_total_mismatch",
        referenceNo: line.referenceNo,
        message:
          `Option ${line.optionCodeRaw}: quantity times unit price is not the printed total.`,
      });
    }

    if (seen.has(line.referenceNo)) {
      issues.push({
        ...where,
        code: "duplicate_line",
        referenceNo: line.referenceNo,
        message:
          `Reference ${line.referenceNo} appears twice in the same Work Order.`,
      });
    }
    seen.add(line.referenceNo);
  }

  if (
    workOrder.declaredTotalCents !== null &&
    workOrder.declaredTotalCents !== sum
  ) {
    issues.push({
      ...where,
      code: "work_order_total_mismatch",
      message: "The lines of a Work Order do not add up to its printed total.",
    });
  }
}

export function parseOlsonVendorNotices(
  pages: PageContent[],
): ParsedPurchaseOrder {
  const workOrders: PurchaseOrderWorkOrder[] = [];
  const issues: PurchaseOrderIssue[] = [];

  let current: PurchaseOrderWorkOrder | null = null;
  let line: PurchaseOrderLine | null = null;
  // True from an option row until the description ends (Stage, revision, total).
  let collecting = false;

  const finish = () => {
    if (current) {
      workOrders.push(current);
      checkWorkOrder(current, issues);
    }
    current = null;
    line = null;
    collecting = false;
  };

  for (const page of pages) {
    for (const text of rowTexts(page)) {
      if (TITLE.test(text)) {
        finish();
        current = emptyWorkOrder(page.page);
        continue;
      }
      if (!current) continue;

      const workOrder = WORK_ORDER.exec(text);
      if (workOrder && current.workOrderNo === "") {
        current.workOrderNo = workOrder[1];
      }

      if (text.includes("Lot/Unit:")) {
        const labels = readHeaderLabels(text);
        current.lotRaw = labels.get("Lot/Unit") ?? null;
        current.phaseRaw = labels.get("Phase") ?? null;
        current.planRaw = labels.get("Plan") ?? null;
        current.tractRaw = labels.get("Tract") ?? null;
        current.elevationRaw = labels.get("Elevation") ?? null;
        continue;
      }

      const option = LINE_ROW.exec(text);
      if (option) {
        const unit = parseSignedCents(option[5]);
        const total = parseSignedCents(option[6]);
        if (unit === null || total === null) continue;
        line = {
          page: page.page,
          optionCodeRaw: option[2],
          referenceNo: option[3],
          date: toIsoDate(option[1]),
          revisedOn: null,
          quantity: Number(option[4]),
          unitPriceCents: unit,
          totalCents: total,
          descriptionLines: [],
          previousCostCents: null,
        };
        current.lines.push(line);
        collecting = true;
        continue;
      }

      if (!line) continue;

      // After the option row: "Revised by ..." and then the description.
      if (collecting) {
        if (DESCRIPTION_STOP.test(text) || MONEY_ONLY.test(text)) {
          collecting = false;
        } else {
          // "Revised by ..." is printed on the row of the first description line
          // or on a row of its own.
          const description = text.replace(REVISED_BY, "").trim();
          if (description !== "") line.descriptionLines.push(description);
          continue;
        }
      }

      const revisedOn = REVISED_ON.exec(text);
      if (revisedOn) line.revisedOn = toIsoDate(revisedOn[1]);
      const changed = COST_CHANGED.exec(text);
      if (changed) line.previousCostCents = parseSignedCents(changed[1]);

      // A row that is only an amount, after the lines, is the work order total.
      if (MONEY_ONLY.test(text)) {
        current.declaredTotalCents = parseSignedCents(text);
      }
    }
  }
  finish();

  return { parser: "olson", workOrders, issues };
}
