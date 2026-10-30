import {
  type AliasMap,
  matchLot,
  matchOption,
  matchPhase,
  matchPlan,
  type OptionCandidate,
  planFitsLotPlan,
} from "./purchaseOrderMatch.ts";
import {
  normalizeLotKey,
  normalizeOptionCode,
  normalizePhaseKey,
  normalizePlanKey,
  planKeyCandidates,
} from "./purchaseOrderNormalize.ts";
import type {
  PurchaseOrderLine,
  PurchaseOrderWorkOrder,
} from "./purchaseOrderTypes.ts";

// Resolves what a work order prints (Lot, Phase, Plan + elevation) to the Lot of
// the Job. Pure: the caller loads the Job's Phases, Plans and Lots and passes them
// in. The Lot is the anchor: its Plan is the one whose options are compared, and
// the printed Plan is only checked against it.
//
// A Phase can exist in several buildings under the same code, so a printed Phase
// stands for every Phase with that code and the Lot number (and Plan) tell them
// apart.

export interface JobPhase {
  id: number;
  code: string;
}

export interface JobPlan {
  id: number;
  code: string;
}

export interface JobLot {
  id: number;
  phaseId: number;
  planId: number;
  lotNumber: string;
}

export interface JobContext {
  phases: JobPhase[];
  plans: JobPlan[];
  lots: JobLot[];
}

export interface HeaderAliases {
  phase?: AliasMap;
  plan?: AliasMap;
}

// The status stored with each line. Must match the check constraint of
// valtrim.purchase_order_lines.header_status.
export type HeaderStatus =
  // Everything matched: by name, or the Plan printed the same way the Lot's Plan
  // reads once the notation is set aside (mirrored "CR" for "C", a spec like STC32).
  | "resolved"
  // Found, but through an abbreviation, a close spelling or by ignoring the
  // elevation. A reviewer confirms it once and it is remembered as an alias.
  | "suggested"
  // More than one Lot, or more than one Phase, fits.
  | "ambiguous"
  // The Lot exists but its Plan is not the one the PO prints.
  | "plan_mismatch"
  | "lot_not_found"
  | "phase_not_found";

export interface HeaderResolution {
  status: HeaderStatus;
  lotId: number | null;
  phaseId: number | null;
  planId: number | null;
  // Small, readable reasons for the reviewer (no document text).
  detail: Record<string, unknown>;
}

interface PhaseGroup {
  code: string;
  ids: number[];
}

function groupPhases(phases: JobPhase[]) {
  const groups = new Map<string, PhaseGroup>();
  for (const phase of phases) {
    const key = normalizePhaseKey(phase.code);
    const group = groups.get(key);
    if (group) group.ids.push(phase.id);
    else groups.set(key, { code: phase.code, ids: [phase.id] });
  }
  return [...groups.values()];
}

function unresolved(
  status: HeaderStatus,
  detail: Record<string, unknown>,
): HeaderResolution {
  return { status, lotId: null, phaseId: null, planId: null, detail };
}

export function resolveHeader(
  workOrder: Pick<
    PurchaseOrderWorkOrder,
    "lotRaw" | "phaseRaw" | "planRaw" | "elevationRaw"
  >,
  context: JobContext,
  aliases: HeaderAliases = {},
): HeaderResolution {
  if (workOrder.lotRaw === null) return unresolved("lot_not_found", {});

  // 1. Phase (a printed Phase can stand for several buildings).
  let phaseIds: Set<number> | null = null;
  let phaseExact = true;
  if (workOrder.phaseRaw !== null) {
    const match = matchPhase(
      workOrder.phaseRaw,
      groupPhases(context.phases),
      aliases.phase,
    );
    if (match.status === "none") {
      return unresolved("phase_not_found", { printed: workOrder.phaseRaw });
    }
    if (match.status === "ambiguous") {
      return unresolved("ambiguous", {
        phases: match.candidates.map((candidate) => candidate.code),
      });
    }
    phaseIds = new Set(match.candidate.ids);
    phaseExact = match.status === "matched";
  }

  // 2. Plan, kept apart: it only verifies the Lot, unless two Lots tie.
  let plan: JobPlan | null = null;
  let planExact = true;
  if (workOrder.planRaw !== null) {
    const match = matchPlan(
      workOrder.planRaw,
      workOrder.elevationRaw,
      context.plans,
      aliases.plan,
    );
    if (match.status === "matched" || match.status === "suggested") {
      plan = match.candidate;
      planExact = match.status === "matched" &&
        match.kind !== "elevation_ignored";
    }
  }

  // Whether the Plan the PO prints is the Lot's own, read by what it says (a printed
  // "2" + "B-R" is the Lot's "2B STC32"), not by letters alone.
  const printedPlanFits = (lot: JobLot) => {
    if (workOrder.planRaw === null) return false;
    const lotPlan = context.plans.find((candidate) =>
      candidate.id === lot.planId
    );
    return lotPlan !== undefined &&
      planFitsLotPlan(workOrder.planRaw, workOrder.elevationRaw, lotPlan.code);
  };

  // 3. Lot: the same number inside the Phase.
  const inPhase = context.lots.filter((lot) =>
    phaseIds === null || phaseIds.has(lot.phaseId)
  );
  const byNumber = matchLot(workOrder.lotRaw, inPhase);
  if (byNumber.status === "none") {
    return unresolved("lot_not_found", { printed: workOrder.lotRaw });
  }

  let candidates: JobLot[];
  if (byNumber.status === "ambiguous") {
    candidates = byNumber.candidates;
  } else if (byNumber.status === "matched" || byNumber.status === "suggested") {
    candidates = [byNumber.candidate];
  } else {
    candidates = [];
  }
  // Several Lots share the number (one per building): the Plan tells them apart.
  if (candidates.length > 1 && workOrder.planRaw !== null) {
    const samePlan = candidates.filter((lot) =>
      (plan !== null && lot.planId === plan.id) || printedPlanFits(lot)
    );
    if (samePlan.length > 0) candidates = samePlan;
  }
  if (candidates.length !== 1) {
    return unresolved("ambiguous", {
      lots: candidates.map((lot) => lot.id),
    });
  }
  const [lot] = candidates;

  // 4. Verify the printed Plan against the Lot's.
  if (workOrder.planRaw !== null) {
    const lotPlan = context.plans.find((candidate) =>
      candidate.id === lot.planId
    );
    const fits = printedPlanFits(lot);
    const same = fits || (plan !== null && plan.id === lot.planId);
    if (!same) {
      return {
        status: "plan_mismatch",
        lotId: lot.id,
        phaseId: lot.phaseId,
        planId: lot.planId,
        detail: {
          printedPlan: workOrder.planRaw,
          printedElevation: workOrder.elevationRaw,
          lotPlan: lotPlan?.code ?? null,
        },
      };
    }
  }

  return {
    status: phaseExact && (planExact || printedPlanFits(lot))
      ? "resolved"
      : "suggested",
    lotId: lot.id,
    phaseId: lot.phaseId,
    planId: lot.planId,
    detail: {},
  };
}

export interface JobPlanOption extends OptionCandidate {
  id: number;
  planId: number;
}

/**
 * The option a line stands for, but only when the code alone is not enough: the
 * Plan has more than one active option with that code and the description makes
 * one of them the clear winner. A single option with the code needs no choice (the
 * database finds it), so this returns null.
 */
export function chooseOptionId(
  line: Pick<PurchaseOrderLine, "optionCodeRaw" | "descriptionLines">,
  planId: number,
  options: JobPlanOption[],
): number | null {
  const key = normalizeOptionCode(line.optionCodeRaw);
  const sameCode = options.filter((option) =>
    option.planId === planId && normalizeOptionCode(option.code) === key
  );
  if (sameCode.length < 2) return null;

  const match = matchOption(
    line.optionCodeRaw,
    line.descriptionLines,
    sameCode,
  );
  return match.status === "matched" ? match.candidate.id : null;
}

/** Keys stored with a line so the latest revision of a Lot's option can be found. */
export function lineKeys(
  workOrder: Pick<PurchaseOrderWorkOrder, "lotRaw" | "phaseRaw">,
) {
  return {
    phaseKey: workOrder.phaseRaw === null
      ? ""
      : normalizePhaseKey(workOrder.phaseRaw),
    lotKey: workOrder.lotRaw === null ? "" : normalizeLotKey(workOrder.lotRaw),
  };
}

// A header as stored with a line, so the lines of a Job can be matched again when
// the Job changes (a Lot added after the PDF was uploaded, a name a reviewer taught).
export interface StoredHeader {
  lotRaw: string | null;
  phaseRaw: string | null;
  planRaw: string | null;
  elevationRaw: string | null;
}

/** Lines sharing a printed header (one work order), so each header is matched once. */
export function groupLinesByHeader<
  T extends {
    id: number;
    lot_raw: string | null;
    phase_raw: string | null;
    plan_raw: string | null;
    elevation_raw: string | null;
  },
>(lines: T[]) {
  const groups = new Map<string, { header: StoredHeader; ids: number[] }>();
  for (const line of lines) {
    const key = JSON.stringify([
      line.lot_raw,
      line.phase_raw,
      line.plan_raw,
      line.elevation_raw,
    ]);
    const group = groups.get(key);
    if (group) group.ids.push(line.id);
    else {
      groups.set(key, {
        header: {
          lotRaw: line.lot_raw,
          phaseRaw: line.phase_raw,
          planRaw: line.plan_raw,
          elevationRaw: line.elevation_raw,
        },
        ids: [line.id],
      });
    }
  }
  return [...groups.values()];
}

export interface LearnedAlias {
  kind: "phase" | "plan";
  rawKey: string;
  targetKey: string;
}

/**
 * What a reviewer confirms when they accept a suggested header: the printed Phase
 * and Plan stand for the Phase and Plan of the Lot they were matched with. Nothing
 * is learned for a part that already matched by name.
 */
export function aliasesToLearn(
  header: StoredHeader,
  lot: JobLot,
  context: Pick<JobContext, "phases" | "plans">,
): LearnedAlias[] {
  const learned: LearnedAlias[] = [];

  const phase = context.phases.find((candidate) =>
    candidate.id === lot.phaseId
  );
  if (header.phaseRaw !== null && phase) {
    const rawKey = normalizePhaseKey(header.phaseRaw);
    const targetKey = normalizePhaseKey(phase.code);
    if (rawKey !== "" && rawKey !== targetKey) {
      learned.push({ kind: "phase", rawKey, targetKey });
    }
  }

  const plan = context.plans.find((candidate) => candidate.id === lot.planId);
  if (header.planRaw !== null && plan) {
    const [rawKey] = planKeyCandidates(header.planRaw, header.elevationRaw);
    const targetKey = normalizePlanKey(plan.code);
    if (rawKey !== undefined && rawKey !== targetKey) {
      learned.push({ kind: "plan", rawKey, targetKey });
    }
  }

  return learned;
}
