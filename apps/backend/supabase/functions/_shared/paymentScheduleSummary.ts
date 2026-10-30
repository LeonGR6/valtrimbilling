import { ASCENT, boxRect, DESCENT, PAD_X, PAD_Y } from "./paymentScheduleGeometry.ts";
import { runCenter } from "./paymentScheduleTypes.ts";
import type { ScheduleRow, SummaryTarget } from "./paymentScheduleTypes.ts";
import type { PageContent, PageRule, TextRun } from "./releaseTypes.ts";

// The two rows a matrix schedule leaves blank for each invoice, "Previously Invoiced"
// and "This Request": one box per draw, where the Package writes its amounts.
//
// Every draw has a cell in each row, whatever it has printed in it. Some schedules
// print a "$" at the left of every cell, some in only one, some in none, so the
// cell is found from what is always there, in this order:
//   1. the borders of the table, when the page draws them: the cell the draw's
//      column has in the row of the label;
//   2. the "$" of the cell, when it has one: the value goes between that sign and
//      the next cell;
//   3. the column the amounts above sit in.
// A "$" inside a cell found by its borders still moves the box to its right.

const PREVIOUSLY_INVOICED = /^previously\s+invoiced$/iu;
const THIS_REQUEST = /^this\s+request$/iu;
const DOLLAR_SIGN = /^\$$/u;

// A border at most this thick is a line; a piece shorter than the next is a mark.
const THIN = 1.6;
const MIN_RULE = 6;
// A box stays this far from the border of its cell.
const INSET = 0.6;
// What a believable cell measures, in points.
const MIN_CELL_WIDTH = 15;
const MAX_CELL_WIDTH = 220;
const MIN_CELL_HEIGHT = 6;
const MAX_CELL_HEIGHT = 40;
// How far an amount ends from the border at its right.
const RIGHT_PAD = 3;
// Where inside the label's line a border has to cross it to be the label's row.
const ROW_HEIGHT_SHARE = 0.3;
// A box narrower than this cannot hold an amount.
const MIN_BOX_WIDTH = 8;

export type SummaryRowKind = "previouslyInvoiced" | "thisRequest";

export function summaryRowKind(label: string): SummaryRowKind | null {
  const text = label.trim();
  if (PREVIOUSLY_INVOICED.test(text)) return "previouslyInvoiced";
  if (THIS_REQUEST.test(text)) return "thisRequest";
  return null;
}

/** Whether a page prints the label of one of the rows. */
export function hasSummaryLabel(runs: TextRun[]) {
  return runs.some((run) => summaryRowKind(run.text) !== null);
}

export interface SummaryColumns {
  // The draws of the table, with the center of the column header of each.
  drawColumns: Array<{ draw: number; center: number }>;
  // Distance between two draw columns, in points.
  pitch: number;
  // The amounts printed under each draw on this page: they show where its text sits.
  amounts: Map<number, TextRun[]>;
}

interface Span {
  left: number;
  right: number;
}

interface Cell {
  left?: number;
  right?: number;
  bottom?: number;
  top?: number;
}

const middle = (rule: PageRule, axis: "x" | "y") =>
  axis === "x" ? (rule.x0 + rule.x1) / 2 : (rule.y0 + rule.y1) / 2;

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

/** Where the text of a draw sits across the page: the middle of its amounts. */
function anchorOf(columns: SummaryColumns, draw: number, header: number) {
  const runs = columns.amounts.get(draw) ?? [];
  return runs.length === 0 ? header : median(runs.map(runCenter));
}

/**
 * The cell around a point, from the borders drawn on the page: the nearest border
 * below and above it that cross the column, and the nearest to the left and right
 * that cross the row. A side comes back only when both borders of the pair do and
 * they are as far apart as a cell can be.
 */
function cellAround(rules: PageRule[], anchor: number, level: number): Cell {
  let below: PageRule | null = null;
  let above: PageRule | null = null;
  let before: PageRule | null = null;
  let after: PageRule | null = null;

  for (const rule of rules) {
    const flat = rule.y1 - rule.y0 <= THIN && rule.x1 - rule.x0 >= MIN_RULE;
    const upright = rule.x1 - rule.x0 <= THIN && rule.y1 - rule.y0 >= MIN_RULE;

    if (flat && rule.x0 <= anchor && rule.x1 >= anchor) {
      const y = middle(rule, "y");
      if (y <= level) {
        if (!below || y > middle(below, "y")) below = rule;
      } else if (!above || y < middle(above, "y")) above = rule;
    } else if (upright && rule.y0 <= level && rule.y1 >= level) {
      const x = middle(rule, "x");
      if (x <= anchor) {
        if (!before || x > middle(before, "x")) before = rule;
      } else if (!after || x < middle(after, "x")) after = rule;
    }
  }

  const cell: Cell = {};
  if (before && after) {
    const left = before.x1 + INSET;
    const right = after.x0 - INSET;
    const width = right - left;
    if (width >= MIN_CELL_WIDTH && width <= MAX_CELL_WIDTH) {
      cell.left = left;
      cell.right = right;
    }
  }
  if (below && above) {
    const bottom = below.y1 + INSET;
    const top = above.y0 - INSET;
    const height = top - bottom;
    if (height >= MIN_CELL_HEIGHT && height <= MAX_CELL_HEIGHT) {
      cell.bottom = bottom;
      cell.top = top;
    }
  }
  return cell;
}

/**
 * The column each draw's amounts sit in, for a page whose cells show no border and
 * no "$". Amounts are right aligned a few points from the border at their right,
 * so that border is a little past the right edge of the amounts, and a cell begins
 * where the one before ends.
 */
function inferredSpans(columns: SummaryColumns) {
  const draws = [...columns.drawColumns].sort((a, b) => a.center - b.center);
  const spans = new Map<number, Span>();
  const half = columns.pitch / 2;

  const rights = new Map<number, number>();
  const offsets: number[] = [];
  for (const { draw, center } of draws) {
    const runs = columns.amounts.get(draw) ?? [];
    if (runs.length === 0) continue;
    const right = Math.max(...runs.map((run) => run.x + run.width));
    rights.set(draw, right);
    offsets.push(right - center);
  }

  // Without amounts to read, a column is one pitch wide around its header.
  if (offsets.length === 0) {
    for (const { draw, center } of draws) {
      spans.set(draw, { left: center - half, right: center + half });
    }
    return spans;
  }

  const typical = median(offsets);
  const edges = draws.map(({ draw, center }) => (rights.get(draw) ?? center + typical) + RIGHT_PAD);
  draws.forEach(({ draw, center }, index) => {
    const right = edges[index];
    const width = index > 0
      ? right - edges[index - 1]
      : edges.length > 1
      ? edges[1] - edges[0]
      : columns.pitch;
    const believable = width >= MIN_CELL_WIDTH && width <= MAX_CELL_WIDTH;
    spans.set(
      draw,
      believable
        ? { left: right - width, right }
        : { left: center - half, right: center + half },
    );
  });
  return spans;
}

/**
 * The "$" printed at the left of a cell belongs to the draw whose column is centered
 * half a cell to its right. The value goes after the sign and before the next one.
 */
function signedSpans(columns: SummaryColumns, signs: TextRun[]) {
  const spans = new Map<number, Span>();
  for (const [index, sign] of signs.entries()) {
    const center = sign.x + columns.pitch / 2;
    let best: { draw: number } | null = null;
    let bestDistance = Infinity;
    for (const column of columns.drawColumns) {
      const distance = Math.abs(column.center - center);
      if (distance < bestDistance) {
        best = column;
        bestDistance = distance;
      }
    }
    if (!best || bestDistance > columns.pitch / 2 || spans.has(best.draw)) continue;

    const left = sign.x + sign.width + 1;
    const right = (signs[index + 1]?.x ?? sign.x + columns.pitch) - 2;
    if (right > left) spans.set(best.draw, { left, right });
  }
  return spans;
}

/** The box of every draw in one summary row, left to right. */
export function readSummaryTargets(
  columns: SummaryColumns,
  row: ScheduleRow,
  page: PageContent,
): SummaryTarget[] {
  const label = row.runs[0];
  if (!label || columns.drawColumns.length === 0) return [];

  const signs = row.runs.filter((run) => DOLLAR_SIGN.test(run.text.trim()));
  const signed = signedSpans(columns, signs);
  const inferred = inferredSpans(columns);
  const level = label.y + label.height * ROW_HEIGHT_SHARE;
  const targets: SummaryTarget[] = [];

  for (const { draw, center } of columns.drawColumns) {
    const cell = page.rules
      ? cellAround(page.rules, anchorOf(columns, draw, center), level)
      : {};

    let left: number;
    let right: number;
    if (cell.left !== undefined && cell.right !== undefined) {
      left = cell.left;
      right = cell.right;
      // A "$" in the cell moves the start of the box past it.
      const sign = signs.find((run) => runCenter(run) >= left && runCenter(run) <= right);
      if (sign) left = Math.max(left, sign.x + sign.width + 1);
    } else if (signed.has(draw)) {
      // Cells with a "$" are separated by the next "$": the box can use a little more.
      left = signed.get(draw)!.left - PAD_X;
      right = signed.get(draw)!.right + PAD_X;
    } else {
      // Inferred columns touch each other, so each box keeps off its neighbours.
      const span = inferred.get(draw);
      if (!span) continue;
      left = span.left + INSET;
      right = span.right - INSET;
    }
    if (right - left < MIN_BOX_WIDTH) continue;

    // The cell's own height when its borders are known, else the label's line.
    const reference = signs[0] ?? label;
    const bottom = cell.bottom ?? reference.y - reference.height * DESCENT - PAD_Y;
    const top = cell.top ?? reference.y + reference.height * ASCENT + PAD_Y;

    targets.push({ draw, page: page.page, rect: boxRect(left, bottom, right, top, page) });
  }

  return targets.sort((a, b) => a.draw - b.draw);
}
