// Shared vocabulary for Payment Schedule analysis. Pure types and helpers:
// nothing here touches the network, Storage or a PDF parser.
//
// A Payment Schedule is a builder's table of Lots and draws. Whatever its
// layout, it reduces to a list of cells: the amount of one draw of one Lot and
// where it sits on the page. A Package later looks its (Lot, draw) pairs up in
// that list and highlights the matching rectangles.

import type { TextRun } from "./releaseTypes.ts";

export type ScheduleLayout = "matrix" | "line_items";

// Rectangle on the page as displayed, normalized 0-1 from the top-left. Same
// convention as the Release mapping, without the page (the cell carries it).
export interface ScheduleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Must match private.validate_payment_schedule_mapping() in the database.
export interface ScheduleCell {
  // As printed in the PDF; null when the document has no Phase.
  phase: string | null;
  // As printed ("0014", "01"). Compare with normalizeCodeKey.
  lot: string;
  // Billing Setup draw number, 1 to 5.
  draw: number;
  // Dollars with two decimals.
  amount: number;
  page: number;
  // Matrix: the amount itself. Line items: the whole row of that Lot and draw.
  rect: ScheduleRect;
}

export interface ScheduleDraw {
  draw: number;
  name: string | null;
  // Builder cost code printed above the draw (480052), when there is one.
  costCode: string | null;
}

// Where one draw's value goes in a summary row of the schedule.
export interface SummaryTarget {
  draw: number;
  page: number;
  rect: ScheduleRect;
}

// The two rows a matrix schedule leaves blank for each invoice, one box per draw:
// what was billed before ("Previously Invoiced") and what the Package bills
// ("This Request").
export interface SummaryRows {
  previouslyInvoiced: SummaryTarget[];
  thisRequest: SummaryTarget[];
}

export type ScheduleIssueCode =
  | "row_total_mismatch"
  | "column_total_mismatch"
  | "grand_total_mismatch"
  | "duplicate_cell"
  | "unrecognized_row"
  | "missing_total";

export interface ScheduleIssue {
  code: ScheduleIssueCode;
  message: string;
  page?: number;
  lot?: string;
  draw?: number;
}

// What one layout parser returns. Amounts are kept in cents until the end so
// sums are exact.
export interface ParsedSchedule {
  layout: ScheduleLayout;
  draws: ScheduleDraw[];
  cells: ScheduleCell[];
  issues: ScheduleIssue[];
  // The rows to fill with the amounts of an invoice; null when the layout has none.
  summaryRows: SummaryRows | null;
  // Total the document prints for the whole schedule, in cents, when it does.
  expectedTotalCents: number | null;
  foundTotalCents: number;
}

export interface ScheduleRow {
  // Baseline of the first run that opened the row.
  y: number;
  // Left to right.
  runs: TextRun[];
}

const SAME_ROW_TOLERANCE = 2.5;

/** Groups text runs that share a baseline into rows, top to bottom. */
export function groupRows(runs: TextRun[]): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const ordered = runs
    .filter((run) => run.text.trim() !== "")
    .sort((left, right) => right.y - left.y || left.x - right.x);

  for (const run of ordered) {
    const row = rows.find((candidate) =>
      Math.abs(candidate.y - run.y) <= SAME_ROW_TOLERANCE
    );
    if (row) row.runs.push(run);
    else rows.push({ y: run.y, runs: [run] });
  }

  for (const row of rows) row.runs.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

const MONEY = /^\$?\s*-?\d[\d,]*\.\d{2}$/u;

/** Cents for a printed amount ("1,929.04", "$198,121.00"), else null. */
export function parseMoneyCents(text: string): number | null {
  const value = text.trim();
  if (!MONEY.test(value)) return null;
  const digits = value.replace(/[$,\s]/gu, "");
  return Math.round(Number(digits) * 100);
}

export function centsToDollars(cents: number) {
  return cents / 100;
}

/**
 * Key to compare a printed Lot or Phase with the system's: case and leading
 * zeros before a digit do not count ("0014" and "14" are the same Lot, and so
 * are "01A" and "1A"; a lone "0" or "0A" keeps its zero).
 */
export function normalizeCodeKey(value: string) {
  return value.trim().toUpperCase().replace(/^0+(?=\d)/u, "");
}

export function runCenter(run: TextRun) {
  return run.x + run.width / 2;
}

export class PaymentScheduleError extends Error {
  readonly reason: "no_text" | "unrecognized_layout";

  constructor(reason: "no_text" | "unrecognized_layout", message: string) {
    super(message);
    this.name = "PaymentScheduleError";
    this.reason = reason;
  }
}
