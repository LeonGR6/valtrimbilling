import { runsRect } from "./paymentScheduleGeometry.ts";
import { readSummaryTargets, summaryRowKind } from "./paymentScheduleSummary.ts";
import type { SummaryColumns } from "./paymentScheduleSummary.ts";
import {
  centsToDollars,
  groupRows,
  normalizeCodeKey,
  parseMoneyCents,
  runCenter,
} from "./paymentScheduleTypes.ts";
import type {
  ParsedSchedule,
  ScheduleCell,
  ScheduleDraw,
  ScheduleIssue,
  ScheduleRow,
  SummaryRows,
} from "./paymentScheduleTypes.ts";
import type { PageContent, TextRun } from "./releaseTypes.ts";

// Matrix layout: one row per Lot, one column per draw.
//
//   Phase  Lot  P/E   480051     480052     ...  Total Price
//                     1st Draw   2nd Draw
//   003    0014 4C    1,929.04   1,446.78        4,822.60
//   ...
//   Total Contract    28,107.36  21,080.52       70,268.40
//
// The header gives each draw its column; every run in a data row is assigned to
// the column whose header is closest, because amounts are right aligned and
// their text starts at a different x than the header's.

const LOT_HEADER = /^lot$/iu;
const PHASE_HEADER = /^phase$/iu;
const PE_HEADER = /^p\s*\/\s*e$/iu;
const TOTAL_HEADER = /^total\s+price$/iu;
const DRAW_LABEL = /^(\d)(?:st|nd|rd|th)\s+draw$/iu;
const COST_CODE = /^\d{5,7}$/u;
const TOTAL_ROW = /^total\b/iu;
const LOT_VALUE = /^[A-Za-z0-9-]+$/u;
// How far a header's cost code can sit from its "Nth Draw" label, in points.
const COST_CODE_REACH = 20;
// A run farther than this share of the narrowest column gap belongs to no column.
const COLUMN_REACH = 0.6;
const HEADER_ROWS = 2;
// How many rows below "Total Contract" are searched for the summary rows.
const SUMMARY_SEARCH_ROWS = 6;

type ColumnKind = "phase" | "lot" | "pe" | "draw" | "total";

interface Column {
  kind: ColumnKind;
  center: number;
  draw?: number;
}

interface MatrixHeader {
  // Distance between the centers of two draw columns, in points.
  pitch: number;
  // Index of the row that holds "Lot"; data starts after the last header row.
  firstRow: number;
  dataStart: number;
  columns: Column[];
  draws: ScheduleDraw[];
  reach: number;
}

function drawOrdinal(text: string) {
  const match = DRAW_LABEL.exec(text.trim());
  return match ? Number(match[1]) : null;
}

function findHeader(rows: ScheduleRow[]): MatrixHeader | null {
  for (let index = 0; index < rows.length; index += 1) {
    const lotRun = rows[index].runs.find((run) => LOT_HEADER.test(run.text.trim()));
    if (!lotRun) continue;

    const last = Math.min(index + HEADER_ROWS, rows.length - 1);
    for (let labelIndex = index; labelIndex <= last; labelIndex += 1) {
      const labels = rows[labelIndex].runs
        .map((run) => ({ run, draw: drawOrdinal(run.text) }))
        .filter((label): label is { run: TextRun; draw: number } =>
          label.draw !== null
        );
      if (labels.length < 2) continue;
      if (new Set(labels.map((label) => label.draw)).size !== labels.length) {
        continue;
      }

      const headerRuns = rows.slice(index, last + 1).flatMap((row) => row.runs);
      const columns: Column[] = [{ kind: "lot", center: runCenter(lotRun) }];
      const phase = headerRuns.find((run) => PHASE_HEADER.test(run.text.trim()));
      if (phase) columns.push({ kind: "phase", center: runCenter(phase) });
      const pe = headerRuns.find((run) => PE_HEADER.test(run.text.trim()));
      if (pe) columns.push({ kind: "pe", center: runCenter(pe) });
      const total = headerRuns.find((run) => TOTAL_HEADER.test(run.text.trim()));
      if (total) columns.push({ kind: "total", center: runCenter(total) });

      const draws: ScheduleDraw[] = [];
      for (const label of labels) {
        const center = runCenter(label.run);
        const code = headerRuns
          .filter((run) => COST_CODE.test(run.text.trim()))
          .sort((a, b) =>
            Math.abs(runCenter(a) - center) - Math.abs(runCenter(b) - center)
          )
          .find((run) => Math.abs(runCenter(run) - center) <= COST_CODE_REACH);
        columns.push({ kind: "draw", center, draw: label.draw });
        draws.push({
          draw: label.draw,
          name: null,
          costCode: code ? code.text.trim() : null,
        });
      }

      const centers = columns.map((column) => column.center).sort((a, b) => a - b);
      let narrowest = Infinity;
      for (let i = 1; i < centers.length; i += 1) {
        narrowest = Math.min(narrowest, centers[i] - centers[i - 1]);
      }

      const drawCenters = columns
        .filter((column) => column.kind === "draw")
        .map((column) => column.center)
        .sort((a, b) => a - b);
      const gaps = drawCenters.slice(1).map((center, i) => center - drawCenters[i])
        .sort((a, b) => a - b);

      return {
        pitch: gaps[Math.floor(gaps.length / 2)],
        firstRow: index,
        dataStart: Math.max(index, labelIndex) + 1,
        columns,
        draws: draws.sort((a, b) => a.draw - b.draw),
        reach: narrowest * COLUMN_REACH,
      };
    }
  }
  return null;
}

/** Names printed in the legend above the table: "480052  Trim Complete". */
function readLegend(rows: ScheduleRow[], header: MatrixHeader) {
  const names = new Map<string, string>();
  for (const row of rows.slice(0, header.firstRow)) {
    const [first, ...rest] = row.runs;
    if (!first || !COST_CODE.test(first.text.trim()) || rest.length === 0) {
      continue;
    }
    names.set(first.text.trim(), rest.map((run) => run.text.trim()).join(" "));
  }
  return names;
}

function columnOf(header: MatrixHeader, run: TextRun) {
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
  return best && bestDistance <= header.reach ? best : null;
}

function cellsText(runs: TextRun[]) {
  return runs.map((run) => run.text.trim()).join(" ").trim();
}

interface RowReading {
  phase: string;
  lot: string;
  total: TextRun | null;
  draws: Map<number, TextRun[]>;
}

function readRow(header: MatrixHeader, row: ScheduleRow): RowReading {
  const reading: RowReading = {
    phase: "",
    lot: "",
    total: null,
    draws: new Map(),
  };
  const byColumn = new Map<Column, TextRun[]>();
  for (const run of row.runs) {
    const column = columnOf(header, run);
    if (!column) continue;
    byColumn.set(column, [...(byColumn.get(column) ?? []), run]);
  }

  for (const [column, runs] of byColumn) {
    if (column.kind === "phase") reading.phase = cellsText(runs);
    else if (column.kind === "lot") reading.lot = cellsText(runs);
    else if (column.kind === "total") reading.total = runs[runs.length - 1];
    else if (column.kind === "draw") reading.draws.set(column.draw!, runs);
  }
  return reading;
}

/** The money run of a draw cell: the schedule prints "$" apart on some rows. */
function moneyRun(runs: TextRun[]) {
  return runs.find((run) => parseMoneyCents(run.text) !== null) ?? null;
}

export function parseMatrixSchedule(pages: PageContent[]): ParsedSchedule | null {
  const cells: ScheduleCell[] = [];
  const issues: ScheduleIssue[] = [];
  const seen = new Set<string>();
  const columnSums = new Map<number, number>();
  const printedColumnTotals = new Map<number, number>();
  let draws: ScheduleDraw[] = [];
  let header: MatrixHeader | null = null;
  let expectedTotal: number | null = null;
  let totalsRowFound = false;
  let grandSum = 0;
  const summary: SummaryRows = { previouslyInvoiced: [], thisRequest: [] };

  for (const page of pages) {
    const rows = groupRows(page.runs);
    // The amounts of this page by draw: they show where each draw's text sits.
    const amounts = new Map<number, TextRun[]>();
    // A page that repeats the header re-reads its columns; one that does not
    // keeps the previous page's.
    const found = findHeader(rows);
    let start = 0;
    if (found) {
      header = found;
      start = found.dataStart;
      const legend = readLegend(rows, found);
      if (draws.length === 0) {
        draws = found.draws.map((draw) => ({
          ...draw,
          name: draw.costCode ? legend.get(draw.costCode) ?? null : null,
        }));
      }
    }
    if (!header) continue;

    for (const row of rows.slice(start)) {
      if (TOTAL_ROW.test(row.runs[0].text.trim())) {
        totalsRowFound = true;
        const reading = readRow(header, row);
        if (reading.total) {
          expectedTotal = parseMoneyCents(reading.total.text);
        }
        for (const [draw, runs] of reading.draws) {
          const run = moneyRun(runs);
          const cents = run ? parseMoneyCents(run.text) : null;
          if (cents === null) continue;
          // Compared after the loop, once every page has added its rows.
          printedColumnTotals.set(draw, cents);
        }

        // The rows to fill sit just below the totals.
        const columns: SummaryColumns = {
          drawColumns: header.columns
            .filter((column) => column.kind === "draw")
            .map((column) => ({ draw: column.draw!, center: column.center })),
          pitch: header.pitch,
          amounts,
        };
        for (const below of rows.slice(rows.indexOf(row) + 1, rows.indexOf(row) + 1 + SUMMARY_SEARCH_ROWS)) {
          const kind = summaryRowKind(below.runs[0]?.text ?? "");
          if (kind && summary[kind].length === 0) {
            summary[kind] = readSummaryTargets(columns, below, page);
          }
        }
        break;
      }

      const reading = readRow(header, row);
      const drawCells = [...reading.draws.entries()]
        .map(([draw, runs]) => ({ draw, run: moneyRun(runs) }))
        .filter((entry): entry is { draw: number; run: TextRun } =>
          entry.run !== null
        );
      if (drawCells.length === 0) continue;
      for (const { draw, run } of drawCells) {
        const column = amounts.get(draw) ?? [];
        column.push(run);
        amounts.set(draw, column);
      }

      if (reading.lot === "" || !LOT_VALUE.test(reading.lot)) {
        issues.push({
          code: "unrecognized_row",
          message: "A row has amounts but no readable Lot number.",
          page: page.page,
        });
        continue;
      }

      let rowCents = 0;
      for (const { draw, run } of drawCells) {
        const cents = parseMoneyCents(run.text)!;
        rowCents += cents;
        columnSums.set(draw, (columnSums.get(draw) ?? 0) + cents);
        grandSum += cents;

        const key = `${normalizeCodeKey(reading.phase)}|${normalizeCodeKey(reading.lot)}|${draw}`;
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
        cells.push({
          phase: reading.phase === "" ? null : reading.phase,
          lot: reading.lot,
          draw,
          amount: centsToDollars(cents),
          page: page.page,
          rect: runsRect([run], page),
        });
      }

      const printedTotal = reading.total ? parseMoneyCents(reading.total.text) : null;
      if (printedTotal !== null && printedTotal !== rowCents) {
        issues.push({
          code: "row_total_mismatch",
          message: "The draws of this Lot do not add up to its Total Price.",
          page: page.page,
          lot: reading.lot,
        });
      }
    }
  }

  if (!header || cells.length === 0) return null;

  if (!totalsRowFound) {
    issues.push({
      code: "missing_total",
      message: "No Total Contract row was found to check the amounts against.",
    });
  } else {
    for (const [draw, printed] of printedColumnTotals) {
      if ((columnSums.get(draw) ?? 0) !== printed) {
        issues.push({
          code: "column_total_mismatch",
          message: "The amounts of this draw do not add up to its printed total.",
          draw,
        });
      }
    }
    if (expectedTotal !== null && expectedTotal !== grandSum) {
      issues.push({
        code: "grand_total_mismatch",
        message: "The amounts do not add up to the printed Total Price.",
      });
    }
  }

  return {
    layout: "matrix",
    draws,
    cells,
    issues,
    summaryRows: summary.previouslyInvoiced.length > 0 || summary.thisRequest.length > 0
      ? summary
      : null,
    expectedTotalCents: expectedTotal,
    foundTotalCents: grandSum,
  };
}
