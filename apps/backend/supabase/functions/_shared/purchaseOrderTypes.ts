// Shared vocabulary for Purchase Order (options) analysis. Pure types: nothing
// here touches the network, Storage or a PDF parser.
//
// A Purchase Order is a builder's work order for the options of one Lot. Whatever
// the builder's layout, it reduces to a list of work orders, each with the Lot it
// is for and the option lines it bills. Header values are kept exactly as printed
// ("MDL", "4", "B"): matching them with the system's Phase, Plan and Lot is a
// separate, pure step (purchaseOrderMatch.ts). Amounts are cents so sums are exact.

export type PurchaseOrderParserName = "olson";

export interface PurchaseOrderLine {
  page: number;
  // As printed ("2FIN5006").
  optionCodeRaw: string;
  referenceNo: string;
  // ISO dates (yyyy-mm-dd) or null when the PDF prints none.
  date: string | null;
  revisedOn: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  // The printed description, one entry per printed line, first line first.
  descriptionLines: string[];
  // "Cost has changed from $0.00 to $81.00": the price before the revision.
  previousCostCents: number | null;
}

export interface PurchaseOrderWorkOrder {
  workOrderNo: string;
  // Page where the work order starts.
  page: number;
  lotRaw: string | null;
  phaseRaw: string | null;
  planRaw: string | null;
  // The system's Plan is the printed Plan plus its elevation ("4" + "B" = "4B").
  elevationRaw: string | null;
  tractRaw: string | null;
  // Total the work order prints for all its lines, when it does.
  declaredTotalCents: number | null;
  lines: PurchaseOrderLine[];
}

export type PurchaseOrderIssueCode =
  | "missing_header"
  | "no_lines"
  | "line_total_mismatch"
  | "work_order_total_mismatch"
  | "duplicate_line";

export interface PurchaseOrderIssue {
  code: PurchaseOrderIssueCode;
  message: string;
  page?: number;
  workOrderNo?: string;
  referenceNo?: string;
}

export interface ParsedPurchaseOrder {
  parser: PurchaseOrderParserName;
  workOrders: PurchaseOrderWorkOrder[];
  issues: PurchaseOrderIssue[];
}

export class PurchaseOrderError extends Error {
  readonly reason: "no_text" | "unrecognized_layout";

  constructor(reason: "no_text" | "unrecognized_layout", message: string) {
    super(message);
    this.name = "PurchaseOrderError";
    this.reason = reason;
  }
}
