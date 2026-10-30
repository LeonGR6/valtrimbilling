import { runsRect } from "./paymentScheduleGeometry.ts";
import {
  centsToDollars,
  groupRows,
  normalizeCodeKey,
  parseMoneyCents,
} from "./paymentScheduleTypes.ts";
import type {
  ParsedSchedule,
  ScheduleCell,
  ScheduleDraw,
  ScheduleIssue,
} from "./paymentScheduleTypes.ts";
import type { PageContent } from "./releaseTypes.ts";

// Line items layout: one row per Lot and draw. Some builders send their
// Payment Schedule as a list like this, laid out as a purchase order.
//
//   Item   Description                   Qty  Rate      Customer         Amount
//   1813   DRAW 2 65% Trim Complete      1    7,518.55  Lot 01 - 2653    7,518.55
//
// Columns are not read by position here: descriptions are left aligned under a
// centered header, so x says little. The row is read by what each run says
// ("DRAW n", "Lot nn", an amount), and the rightmost amount is the Amount.

const DESCRIPTION_HEADER = /^description$/iu;
const AMOUNT_HEADER = /^amount$/iu;
const DRAW_TEXT = /\bdraw\s*(\d)\b\s*(?:(\d+(?:\.\d+)?)\s*%)?\s*(.*)$/iu;
const LOT_TEXT = /\blot\s*#?\s*([A-Za-z0-9]+)/iu;
const PHASE_TEXT = /\bphase\s*#?\s*([A-Za-z0-9]+)/iu;
const TOTAL_LABEL = /^total$/iu;

function isHeader(texts: string[]) {
  return texts.some((text) => DESCRIPTION_HEADER.test(text)) &&
    texts.some((text) => AMOUNT_HEADER.test(text));
}

export function parseLineItemSchedule(
  pages: PageContent[],
): ParsedSchedule | null {
  const cells: ScheduleCell[] = [];
  const issues: ScheduleIssue[] = [];
  const names = new Map<number, string>();
  const seen = new Set<string>();
  let expectedTotal: number | null = null;
  let tableStarted = false;
  let foundTotal = 0;

  for (const page of pages) {
    for (const row of groupRows(page.runs)) {
      const texts = row.runs.map((run) => run.text.trim());
      if (isHeader(texts)) {
        tableStarted = true;
        continue;
      }
      // A page without its own header continues the table of the previous one.
      if (!tableStarted) continue;

      const money = row.runs.filter((run) => parseMoneyCents(run.text) !== null);
      if (texts.some((text) => TOTAL_LABEL.test(text)) && money.length > 0) {
        expectedTotal = parseMoneyCents(money[money.length - 1].text);
        continue;
      }

      const drawRun = row.runs.find((run) => DRAW_TEXT.test(run.text));
      const lotRun = row.runs.find((run) => LOT_TEXT.test(run.text));
      if (!drawRun || !lotRun) continue;
      if (money.length === 0) {
        issues.push({
          code: "unrecognized_row",
          message: "A Lot and draw row has no readable amount.",
          page: page.page,
        });
        continue;
      }

      const drawMatch = DRAW_TEXT.exec(drawRun.text)!;
      const draw = Number(drawMatch[1]);
      const lot = LOT_TEXT.exec(lotRun.text)![1];
      const phaseRun = row.runs.find((run) => PHASE_TEXT.test(run.text));
      const phase = phaseRun ? PHASE_TEXT.exec(phaseRun.text)![1] : null;
      const amountRun = money[money.length - 1];
      const cents = parseMoneyCents(amountRun.text)!;

      const name = drawMatch[3].trim();
      if (name !== "" && !names.has(draw)) names.set(draw, name);

      const key = `${normalizeCodeKey(phase ?? "")}|${normalizeCodeKey(lot)}|${draw}`;
      if (seen.has(key)) {
        issues.push({
          code: "duplicate_cell",
          message: "The same Phase, Lot and draw appears more than once.",
          page: page.page,
          lot,
          draw,
        });
        continue;
      }
      seen.add(key);

      foundTotal += cents;
      cells.push({
        phase,
        lot,
        draw,
        amount: centsToDollars(cents),
        page: page.page,
        rect: runsRect(row.runs, page),
      });
    }
  }

  if (cells.length === 0) return null;

  if (expectedTotal === null) {
    issues.push({
      code: "missing_total",
      message: "No Total row was found to check the amounts against.",
    });
  } else if (expectedTotal !== foundTotal) {
    issues.push({
      code: "grand_total_mismatch",
      message: "The amounts do not add up to the printed Total.",
    });
  }

  const draws: ScheduleDraw[] = [...new Set(cells.map((cell) => cell.draw))]
    .sort((a, b) => a - b)
    .map((draw) => ({ draw, name: names.get(draw) ?? null, costCode: null }));

  return {
    layout: "line_items",
    draws,
    cells,
    issues,
    summaryRows: null,
    expectedTotalCents: expectedTotal,
    foundTotalCents: foundTotal,
  };
}
