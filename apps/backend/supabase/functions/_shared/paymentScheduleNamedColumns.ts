import { runsRect } from "./paymentScheduleGeometry.ts";
import {
  centsToDollars,
  groupRows,
  normalizeCodeKey,
  parseMoneyCents,
  runCenter,
} from "./paymentScheduleTypes.ts";
import type {
  DrawName,
  ParsedSchedule,
  ScheduleCell,
  ScheduleDraw,
  ScheduleIssue,
  ScheduleRow,
} from "./paymentScheduleTypes.ts";
import type { PageContent, TextRun } from "./releaseTypes.ts";

// Named columns layout: a matrix whose draws are not numbered. Each column carries
// the name of the stage it bills, and that name is the one the Job's Billing Setup
// gives the draw.
//
//   Seq  Lot  Plan   Price     EXT. FRAMES  MATL INSTALL  HW INSTALLED  RETENTION
//   1    14   4B     7,378.06  1,106.71     5,164.64      368.90        737.81
//   ...
//
// Without "1st Draw" there is nothing in the document that says which draw a column
// is, so the names are the only way to number it. A heading that is not a draw of the
// Billing Setup is never guessed from its position: a wrong number would send an
// amount to the wrong draw, and the review cannot renumber it. The schedule is not
// recognized instead, and the message says which names it expects.

const LOT_HEADER = /^lot(?:\s*(?:#|no\.?|number))?$/iu;
const PHASE_HEADER = /^phase$/iu;
// The Lot's whole price, which its draws split: "Price", "Total Price", "Contract Amount".
const TOTAL_HEADER = /^(?:total\s+|contract\s+)?(?:price|amount|total)$/iu;
const TOTAL_ROW = /^total\b/iu;
// A Lot or a Phase can carry a decimal: 12 and 12.1, Phase 2 and 2.1, are different.
const LOT_VALUE = /^[A-Za-z0-9-]+(?:\.\d+)?$/u;
const PHASE_LABEL = /^phase\s*:?$/iu;
const PHASE_VALUE = /^(?=.{1,10}$)[A-Za-z0-9-]+(?:\.\d+)?$/u;
const COUNT = /^\d{1,4}$/u;
// A run farther than this share of the narrowest gap between amount columns belongs to none.
const COLUMN_REACH = 0.6;
// Two runs of a heading are one name when the gap between them is at most this many
// font heights: a space, not a column.
const NAME_GAP = 0.6;
// The value of "Phase:" sits right after its label, at most this far in points.
const PHASE_VALUE_REACH = 60;

// A heading of the row of "Lot". Only draws and the Lot's whole price hold amounts; the
// rest are kept so an amount that sits under one of them is noticed, not given to a draw.
interface Column {
  kind: "draw" | "total" | "other";
  center: number;
  draw: number | null;
}

interface NamedHeader {
  // Index of the row that holds "Lot".
  row: number;
  lot: number;
  phase: number | null;
  columns: Column[];
  draws: ScheduleDraw[];
  // How far an amount may sit from the center of its heading.
  reach: number;
  // How far a Lot or Phase value may sit from its heading.
  lotReach: number;
  phaseReach: number;
}

/** A heading compared by its letters and digits: "EXT. FRAMES" and "Ext Frames" are one. */
function nameKey(text: string) {
  return text.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The names that tell one draw: a name two draws share tells none of them. */
function drawsByName(drawNames: DrawName[]) {
  const byKey = new Map<string, number | null>();
  for (const { draw, name } of drawNames) {
    const key = nameKey(name);
    if (key === "") continue;
    byKey.set(key, byKey.has(key) ? null : draw);
  }
  const unique = new Map<string, number>();
  for (const [key, draw] of byKey) if (draw !== null) unique.set(key, draw);
  return unique;
}

// A name of two or three words can reach the page as separate runs.
const MAX_NAME_RUNS = 3;

/** The draw a heading names, with the runs it spans: one, or several that are one name. */
function drawAt(runs: TextRun[], index: number, names: Map<string, number>) {
  for (let take = 1; take <= MAX_NAME_RUNS && index + take <= runs.length; take += 1) {
    const span = runs.slice(index, index + take);
    const near = span.every((run, i) =>
      i === 0 || run.x - (span[i - 1].x + span[i - 1].width) <= run.height * NAME_GAP
    );
    if (!near) break;

    const text = span.map((run) => run.text.trim()).join(" ");
    const draw = names.get(nameKey(text));
    if (draw !== undefined) return { draw, take, text };
  }
  return null;
}

function narrowestGap(centers: number[]) {
  const ordered = [...centers].sort((a, b) => a - b);
  let narrowest = Infinity;
  for (let i = 1; i < ordered.length; i += 1) {
    narrowest = Math.min(narrowest, ordered[i] - ordered[i - 1]);
  }
  return narrowest;
}

function findHeader(rows: ScheduleRow[], names: Map<string, number>): NamedHeader | null {
  for (let index = 0; index < rows.length; index += 1) {
    const runs = rows[index].runs;
    const lotRun = runs.find((run) => LOT_HEADER.test(run.text.trim()));
    if (!lotRun) continue;

    const seen = new Set<number>();
    const draws: ScheduleDraw[] = [];
    const columns: Column[] = [];
    let total: TextRun | null = null;
    for (let at = 0; at < runs.length;) {
      const run = runs[at];
      const named = drawAt(runs, at, names);
      if (named && !seen.has(named.draw)) {
        seen.add(named.draw);
        const span = runs.slice(at, at + named.take);
        const center = (span[0].x + span[span.length - 1].x + span[span.length - 1].width) / 2;
        draws.push({ draw: named.draw, name: named.text, costCode: null });
        columns.push({ kind: "draw", center, draw: named.draw });
        at += named.take;
        continue;
      }
      if (!total && TOTAL_HEADER.test(run.text.trim())) {
        total = run;
        columns.push({ kind: "total", center: runCenter(run), draw: null });
      } else {
        columns.push({ kind: "other", center: runCenter(run), draw: null });
      }
      at += 1;
    }
    if (draws.length < 2) continue;

    const phaseRun = runs.find((run) => PHASE_HEADER.test(run.text.trim()));
    // A Lot or Phase value is text under its heading: it belongs to that heading when it
    // is closer to it than to the heading beside.
    const textReach = (heading: TextRun) =>
      Math.min(
        ...runs.filter((other) => other !== heading).map((other) =>
          Math.abs(runCenter(other) - runCenter(heading))
        ),
      ) * COLUMN_REACH;

    return {
      row: index,
      lot: runCenter(lotRun),
      lotReach: textReach(lotRun),
      phase: phaseRun ? runCenter(phaseRun) : null,
      phaseReach: phaseRun ? textReach(phaseRun) : 0,
      columns,
      draws: draws.sort((a, b) => a.draw - b.draw),
      reach: narrowestGap(
        columns.filter((column) => column.kind !== "other").map((column) => column.center),
      ) * COLUMN_REACH,
    };
  }
  return null;
}

/** The run closest to a center, within reach. */
function closest(runs: TextRun[], center: number, reach: number) {
  let best: TextRun | null = null;
  let bestDistance = Infinity;
  for (const run of runs) {
    const distance = Math.abs(runCenter(run) - center);
    if (distance < bestDistance) {
      best = run;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= reach ? best : null;
}

/** The draw (or price) column an amount sits under; none when another heading is closer. */
function amountColumnOf(header: NamedHeader, run: TextRun) {
  const center = runCenter(run);
  let best: Column | null = null;
  let bestDistance = Infinity;
  for (const column of header.columns) {
    const distance = Math.abs(column.center - center);
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  return best && best.kind !== "other" && bestDistance <= header.reach ? best : null;
}

interface RowReading {
  lot: string;
  phase: string | null;
  total: TextRun | null;
  draws: Map<number, TextRun>;
  // Amounts under a heading that is not a draw of the Billing Setup.
  stray: number;
}

function readRow(header: NamedHeader, row: ScheduleRow): RowReading {
  const reading: RowReading = { lot: "", phase: null, total: null, draws: new Map(), stray: 0 };
  const words: TextRun[] = [];

  for (const run of row.runs) {
    if (parseMoneyCents(run.text) === null) {
      words.push(run);
      continue;
    }
    const column = amountColumnOf(header, run);
    if (!column) {
      reading.stray += 1;
      continue;
    }
    if (column.draw === null) reading.total ??= run;
    else if (!reading.draws.has(column.draw)) reading.draws.set(column.draw, run);
  }

  const lot = closest(words, header.lot, header.lotReach);
  if (lot && LOT_VALUE.test(lot.text.trim())) reading.lot = lot.text.trim();
  if (header.phase !== null) {
    const phase = closest(words, header.phase, header.phaseReach);
    if (phase) reading.phase = phase.text.trim();
  }
  return reading;
}

/** "Phase: 2" printed above the table, for a schedule with no Phase column. */
function readPrintedPhase(rows: ScheduleRow[]) {
  for (const row of rows) {
    const index = row.runs.findIndex((run) => PHASE_LABEL.test(run.text.trim()));
    const label = row.runs[index];
    const value = row.runs[index + 1];
    if (
      label && value && PHASE_VALUE.test(value.text.trim()) &&
      value.x - (label.x + label.width) <= PHASE_VALUE_REACH
    ) {
      return value.text.trim();
    }
  }
  return null;
}

/**
 * The total some schedules print above the table, in the summary of Plans: a row
 * with how many Lots there are and what they come to. It is taken only when the
 * count is the number of Lots read, so no other row passes for it.
 */
function readContractTotal(rows: ScheduleRow[], lotCount: number) {
  for (const row of rows) {
    const [count, total] = row.runs;
    if (
      row.runs.length === 2 && COUNT.test(count.text.trim()) &&
      Number(count.text) === lotCount
    ) {
      const cents = parseMoneyCents(total.text);
      if (cents !== null) return cents;
    }
  }
  return null;
}

/**
 * Cents a Lot's draws can be from its price. Each draw is a percentage of the price
 * rounded to the cent, so the sum of n draws can drift by half a cent for each.
 */
function roundingCents(drawCount: number) {
  return Math.ceil(drawCount / 2);
}

export function parseNamedColumnSchedule(
  pages: PageContent[],
  drawNames: DrawName[],
): ParsedSchedule | null {
  const names = drawsByName(drawNames);
  if (names.size < 2) return null;

  const cells: ScheduleCell[] = [];
  const issues: ScheduleIssue[] = [];
  const seen = new Set<string>();
  const lots = new Set<string>();
  let header: NamedHeader | null = null;
  let draws: ScheduleDraw[] = [];
  let aboveTable: ScheduleRow[] = [];
  let printedTotal: number | null = null;
  let grandSum = 0;
  let strayPage: number | null = null;

  for (const page of pages) {
    const rows = groupRows(page.runs);
    const found = findHeader(rows, names);
    let start = 0;
    if (found) {
      header = found;
      start = found.row + 1;
      if (draws.length === 0) {
        draws = found.draws;
        aboveTable = rows.slice(0, found.row);
      }
    }
    if (!header) continue;

    for (const row of rows.slice(start)) {
      if (TOTAL_ROW.test(row.runs[0].text.trim())) {
        const reading = readRow(header, row);
        if (reading.total) printedTotal = parseMoneyCents(reading.total.text);
        break;
      }

      const reading = readRow(header, row);
      if (reading.stray > 0) strayPage ??= page.page;
      if (reading.draws.size === 0) continue;
      if (reading.lot === "") {
        issues.push({
          code: "unrecognized_row",
          message: "A row has amounts but no readable Lot number.",
          page: page.page,
        });
        continue;
      }

      let rowCents = 0;
      for (const [draw, run] of reading.draws) {
        const cents = parseMoneyCents(run.text)!;
        rowCents += cents;
        grandSum += cents;

        const key = `${normalizeCodeKey(reading.phase ?? "")}|${normalizeCodeKey(reading.lot)}|${draw}`;
        if (seen.has(key)) {
          issues.push({
            code: "duplicate_cell",
            message: "The same Phase, Lot and draw appears more than once.",
            page: page.page,
            lot: reading.lot,
            draw,
          });
          continue;
        }
        seen.add(key);
        lots.add(`${normalizeCodeKey(reading.phase ?? "")}|${normalizeCodeKey(reading.lot)}`);
        cells.push({
          phase: reading.phase,
          lot: reading.lot,
          draw,
          amount: centsToDollars(cents),
          page: page.page,
          rect: runsRect([run], page),
        });
      }

      const price = reading.total ? parseMoneyCents(reading.total.text) : null;
      if (price !== null && Math.abs(price - rowCents) > roundingCents(header.draws.length)) {
        issues.push({
          code: "row_total_mismatch",
          message: "The draws of this Lot do not add up to its Price.",
          page: page.page,
          lot: reading.lot,
        });
      }
    }
  }

  if (!header || cells.length === 0) return null;

  // An amount under a heading the Billing Setup does not know is left out, and said so:
  // the draw it belongs to is anyone's guess.
  if (strayPage !== null) {
    issues.push({
      code: "unrecognized_row",
      message: "Some amounts sit under a heading that is not a draw of the Billing Setup.",
      page: strayPage,
    });
  }

  // Without a Phase column, the Phase printed above the table is the one of every Lot.
  const printedPhase = header.phase === null ? readPrintedPhase(aboveTable) : null;
  if (printedPhase !== null) {
    for (const cell of cells) cell.phase = printedPhase;
  }

  const expectedTotal = printedTotal ?? readContractTotal(aboveTable, lots.size);
  const tolerance = lots.size * roundingCents(header.draws.length);
  if (expectedTotal === null) {
    issues.push({
      code: "missing_total",
      message: "No total was found to check the amounts against.",
    });
  } else if (Math.abs(expectedTotal - grandSum) > tolerance) {
    issues.push({
      code: "grand_total_mismatch",
      message: "The amounts do not add up to the printed Total.",
    });
  }

  return {
    layout: "matrix",
    draws,
    cells,
    issues,
    summaryRows: null,
    expectedTotalCents: expectedTotal,
    foundTotalCents: grandSum,
    totalToleranceCents: tolerance,
  };
}
