import { runsRect } from "./paymentScheduleGeometry.ts";
import {
  centsToDollars,
  normalizeCodeKey,
  PaymentScheduleError,
} from "./paymentScheduleTypes.ts";
import type {
  ParsedSchedule,
  ScheduleCell,
  ScheduleDraw,
  ScheduleIssue,
  ScheduleUtilityCell,
} from "./paymentScheduleTypes.ts";
import { wordKey } from "./paymentScheduleAi.ts";
import type { AiAnswer, AiDocument, AiJobContext, AiJobLot } from "./paymentScheduleAi.ts";

// Turns what the AI said into cells, and checks each one against the PDF and the Job.
// Pure: no network, no database. Nothing the model says is trusted:
// - an amount exists only if its reference is printed in the PDF, and its value,
//   page and highlight come from the PDF;
// - a Lot must exist in the Job, a draw in its Billing Setup;
// - the draws of a Lot must add up to the price of its Plan and follow the Billing
//   Setup percentages;
// - a Utility amount must be the Phase's utility building price split among its Lots.
// What does not hold becomes an issue the reviewer must look at before confirming.

// Splitting a price into draws by percentage rounds each draw.
const ROUNDING_CENTS = 1;

export interface AiSummary {
  model: string;
  notes: string[];
  // Lots whose draws add up to the price of their Plan in the Job.
  lotsMatchingPrice: number;
  lotsChecked: number;
  utility: { count: number; matching: number; totalCents: number } | null;
}

export interface VerifiedAiSchedule extends ParsedSchedule {
  ai: AiSummary;
}

const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents: number) => moneyFormat.format(cents / 100);

function indexJobLots(context: AiJobContext) {
  const byLot = new Map<string, AiJobLot[]>();
  const homesByPhase = new Map<string, AiJobLot[]>();
  const utilityByPhase = new Map<string, AiJobLot>();

  for (const lot of context.lots) {
    const phaseKey = normalizeCodeKey(lot.phase);
    if (lot.utility) {
      utilityByPhase.set(phaseKey, lot);
      continue;
    }
    const key = normalizeCodeKey(lot.lot);
    byLot.set(key, [...(byLot.get(key) ?? []), lot]);
    homesByPhase.set(phaseKey, [...(homesByPhase.get(phaseKey) ?? []), lot]);
  }
  return { byLot, homesByPhase, utilityByPhase };
}

/** The Job Lot a printed Lot stands for: by number, and by Phase when several share it. */
function findJobLot(lot: string, phase: string | null, byLot: Map<string, AiJobLot[]>) {
  const candidates = byLot.get(normalizeCodeKey(lot)) ?? [];
  if (candidates.length <= 1) return { lot: candidates[0] ?? null, ambiguous: false };
  if (phase) {
    const same = candidates.filter((candidate) =>
      normalizeCodeKey(candidate.phase) === normalizeCodeKey(phase)
    );
    if (same.length === 1) return { lot: same[0], ambiguous: false };
  }
  return { lot: null, ambiguous: true };
}

export function verifyAiAnswer(
  answer: AiAnswer,
  document: AiDocument,
  context: AiJobContext,
  model: string,
): VerifiedAiSchedule {
  const cells: ScheduleCell[] = [];
  const utilityCells: ScheduleUtilityCell[] = [];
  const seenUtility = new Set<string>();
  const issues: ScheduleIssue[] = [];
  const setupDraws = [...context.draws].sort((a, b) => a.draw - b.draw);
  const knownDraws = new Set(setupDraws.map(({ draw }) => draw));
  const { byLot, homesByPhase, utilityByPhase } = indexJobLots(context);
  const usedRefs = new Set<string>();
  const seenCells = new Set<string>();
  const seenJobLots = new Set<AiJobLot>();
  let missingRefs = 0;
  let unknownDraws = 0;
  let lotsChecked = 0;
  let lotsMatchingPrice = 0;
  let utility: AiSummary["utility"] = null;

  for (const entry of answer.lots) {
    // A Phase counts only when the PDF prints it.
    const phase = entry.phase && document.words.has(wordKey(entry.phase)) ? entry.phase : null;
    const found = findJobLot(entry.lot, phase, byLot);
    const jobLot = found.lot;
    if (!jobLot && !found.ambiguous) {
      issues.push({
        code: "unknown_lot",
        message: "This Lot is not in the Job. Check it or remove its amounts.",
        lot: entry.lot,
      });
    }
    if (jobLot) seenJobLots.add(jobLot);

    const lotCents = new Map<number, number>();
    for (const { draw, ref } of entry.draws) {
      const amount = document.refs.get(ref);
      if (!amount || usedRefs.has(ref)) {
        if (!amount) missingRefs += 1;
        else {
          issues.push({
            code: "duplicate_cell",
            message: "The same printed amount was given to two draws.",
            page: amount.page.page,
            lot: entry.lot,
            draw,
          });
        }
        continue;
      }
      if (!knownDraws.has(draw)) {
        unknownDraws += 1;
        continue;
      }
      const key = `${normalizeCodeKey(phase ?? "")}|${normalizeCodeKey(entry.lot)}|${draw}`;
      if (seenCells.has(key)) {
        issues.push({
          code: "duplicate_cell",
          message: "The same Lot and draw was found more than once.",
          page: amount.page.page,
          lot: entry.lot,
          draw,
        });
        continue;
      }
      usedRefs.add(ref);
      seenCells.add(key);
      lotCents.set(draw, amount.cents);
      cells.push({
        phase,
        lot: entry.lot,
        draw,
        amount: centsToDollars(amount.cents),
        page: amount.page.page,
        rect: runsRect(amount.row.runs, amount.page),
      });
    }

    if (jobLot && lotCents.size > 0) {
      const missing = setupDraws.filter(({ draw }) => !lotCents.has(draw));
      if (missing.length > 0) {
        issues.push({
          code: "missing_draw",
          message: `No amount was found for ${
            missing.map(({ draw, name }) => `draw ${draw} (${name})`).join(", ")
          }.`,
          lot: entry.lot,
        });
      }

      const sum = [...lotCents.values()].reduce((total, cents) => total + cents, 0);
      if (missing.length === 0 && jobLot.priceCents !== null) {
        lotsChecked += 1;
        if (sum === jobLot.priceCents) lotsMatchingPrice += 1;
        else {
          issues.push({
            code: "price_mismatch",
            message: `The draws add up to ${money(sum)}, but in the Job ${
              jobLot.plan ? `its Plan ${jobLot.plan}` : "its Plan"
            } costs ${money(jobLot.priceCents)}.`,
            lot: entry.lot,
          });
        }
      }

      if (missing.length === 0) {
        const off = setupDraws.filter(({ draw, percentage }) =>
          percentage !== null &&
          Math.abs(lotCents.get(draw)! - Math.round((sum * percentage) / 100)) > ROUNDING_CENTS
        );
        if (off.length > 0) {
          issues.push({
            code: "percentage_mismatch",
            message: `Not split as the Billing Setup says: ${
              off.map(({ draw, percentage }) =>
                `draw ${draw} is ${money(lotCents.get(draw)!)}, ${percentage}% would be ${
                  money(Math.round((sum * percentage!) / 100))
                }`
              ).join("; ")
            }.`,
            lot: entry.lot,
          });
        }
      }
    }

    if (entry.utility) {
      const amount = document.refs.get(entry.utility);
      if (!amount || usedRefs.has(entry.utility)) {
        if (!amount) missingRefs += 1;
        continue;
      }
      const utilityKey = `${normalizeCodeKey(phase ?? "")}|${normalizeCodeKey(entry.lot)}`;
      if (seenUtility.has(utilityKey)) {
        issues.push({
          code: "duplicate_cell",
          message: "The same Lot has more than one Utility amount.",
          page: amount.page.page,
          lot: entry.lot,
        });
        continue;
      }
      seenUtility.add(utilityKey);
      usedRefs.add(entry.utility);
      utilityCells.push({
        phase,
        lot: entry.lot,
        amount: centsToDollars(amount.cents),
        page: amount.page.page,
        rect: runsRect(amount.row.runs, amount.page),
      });
      utility ??= { count: 0, matching: 0, totalCents: 0 };
      utility.count += 1;
      utility.totalCents += amount.cents;

      const phaseKey = jobLot ? normalizeCodeKey(jobLot.phase) : null;
      const building = phaseKey ? utilityByPhase.get(phaseKey) : undefined;
      const homes = phaseKey ? homesByPhase.get(phaseKey)?.length ?? 0 : 0;
      if (!building || building.priceCents === null || homes === 0) {
        issues.push({
          code: "utility_mismatch",
          message: `A Utility amount of ${money(amount.cents)} was found, but the Job has no priced utility building in this Lot's Phase to check it against.`,
          page: amount.page.page,
          lot: entry.lot,
        });
        continue;
      }
      const share = Math.round(building.priceCents / homes);
      if (Math.abs(amount.cents - share) <= ROUNDING_CENTS) utility.matching += 1;
      else {
        issues.push({
          code: "utility_mismatch",
          message: `The Utility amount is ${money(amount.cents)}, but the utility building of Phase ${
            jobLot!.phase
          } (${money(building.priceCents)}) split among its ${homes} Lots is ${money(share)}.`,
          page: amount.page.page,
          lot: entry.lot,
        });
      }
    }
  }

  if (cells.length === 0) {
    throw new PaymentScheduleError(
      "unrecognized_layout",
      "The AI could not find the Lots and draws of this Payment Schedule either. Check that it is the right PDF.",
    );
  }

  if (missingRefs > 0) {
    issues.push({
      code: "unrecognized_row",
      message: `The AI pointed at ${missingRefs} amount${
        missingRefs === 1 ? "" : "s"
      } that are not printed in the PDF; they were left out.`,
    });
  }
  if (unknownDraws > 0) {
    issues.push({
      code: "unrecognized_row",
      message: `${unknownDraws} amount${
        unknownDraws === 1 ? " was" : "s were"
      } given a draw the Billing Setup does not have; they were left out.`,
    });
  }

  // Lots of the Phases this PDF covers that it says nothing about. A PDF for one
  // Phase does not have to list the others.
  const coveredPhases = new Set([...seenJobLots].map((lot) => normalizeCodeKey(lot.phase)));
  const absent = [...coveredPhases].flatMap((phase) =>
    (homesByPhase.get(phase) ?? []).filter((lot) => !seenJobLots.has(lot))
  );
  if (absent.length > 0) {
    issues.push({
      code: "missing_lots",
      message: `Lots of the Job not found in the PDF: ${
        absent.map((lot) => `${lot.lot} (Phase ${lot.phase})`).join(", ")
      }.`,
    });
  }

  const codes = new Map(
    answer.drawLabels
      .filter(({ code }) => code && document.words.has(wordKey(code)))
      .map(({ draw, code }) => [draw, code]),
  );
  const draws: ScheduleDraw[] = setupDraws
    .filter(({ draw }) => cells.some((cell) => cell.draw === draw))
    .map(({ draw, name }) => ({ draw, name, costCode: codes.get(draw) ?? null }));

  return {
    layout: "line_items",
    draws,
    cells,
    issues,
    summaryRows: null,
    expectedTotalCents: null,
    foundTotalCents: cells.reduce((total, cell) => total + Math.round(cell.amount * 100), 0),
    totalToleranceCents: 0,
    ...(utilityCells.length > 0 ? { utilityCells } : {}),
    ai: {
      model,
      notes: answer.notes,
      lotsMatchingPrice,
      lotsChecked,
      utility,
    },
  };
}
