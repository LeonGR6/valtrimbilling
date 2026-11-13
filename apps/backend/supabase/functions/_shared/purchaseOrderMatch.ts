import {
  descriptionTokens,
  normalizeLotKey,
  normalizeOptionCode,
  normalizePhaseKey,
  planKeyCandidates,
  planParts,
} from "./purchaseOrderNormalize.ts";

// Matches what a Purchase Order prints with the system's Phases, Plans, Lots and
// Options. Pure: the caller passes the candidates it loaded.
//
// Nothing here picks silently when it is unsure. A result is one of:
//   matched    - the same thing once normalized (or a learned alias)
//   suggested  - probably the same (an abbreviation or a close spelling); the
//                reviewer confirms it, and the choice can be remembered as an alias
//   ambiguous  - more than one candidate fits; the reviewer chooses
//   none       - nothing fits

export type MatchKind =
  | "exact"
  | "alias"
  | "plural"
  | "abbreviation"
  | "similar"
  | "elevation_ignored";

export type Match<T> =
  | { status: "matched"; kind: MatchKind; candidate: T }
  | { status: "suggested"; kind: MatchKind; candidate: T; score: number }
  | { status: "ambiguous"; candidates: T[] }
  | { status: "none" };

interface Keyed<T> {
  key: string;
  value: T;
}

// Alias learned from a reviewer: printed key -> system key.
export type AliasMap = ReadonlyMap<string, string>;

const SIMILAR_THRESHOLD = 0.7;
const NONE = { status: "none" } as const;

function bigrams(value: string) {
  const grams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.add(value.slice(index, index + 2));
  }
  return grams;
}

/** Dice coefficient of two strings by letter pairs, 0 to 1. */
export function stringSimilarity(left: string, right: string) {
  if (left === right) return 1;
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function isSubsequence(short: string, long: string) {
  let at = 0;
  for (const char of long) {
    if (char === short[at]) at += 1;
    if (at === short.length) return true;
  }
  return false;
}

function singular(key: string) {
  return key.length > 2 && key.endsWith("S") ? key.slice(0, -1) : key;
}

const LETTERS_ONLY = /^[A-Z]+$/u;

function resolve<T>(
  hits: Keyed<T>[],
  found: (candidate: T) => Match<T>,
): Match<T> | null {
  if (hits.length === 0) return null;
  if (hits.length > 1) {
    return { status: "ambiguous", candidates: hits.map(({ value }) => value) };
  }
  return found(hits[0].value);
}

/**
 * Finds the target a printed key stands for, trying the strictest rule first:
 * same key, learned alias, plural, abbreviation ("MDL" for "MODELS"), then a
 * close spelling. The last two only compare words made of letters only, so Plans
 * like "4B" and "4C", or Lots, are never matched by resemblance.
 */
export function matchKey<T>(
  rawKey: string,
  targets: Keyed<T>[],
  aliases?: AliasMap,
): Match<T> {
  if (rawKey === "") return NONE;

  const exact = resolve(
    targets.filter(({ key }) => key === rawKey),
    (candidate) => ({ status: "matched", kind: "exact", candidate }),
  );
  if (exact) return exact;

  const aliasKey = aliases?.get(rawKey);
  if (aliasKey !== undefined) {
    const aliased = resolve(
      targets.filter(({ key }) => key === aliasKey),
      (candidate) => ({ status: "matched", kind: "alias", candidate }),
    );
    if (aliased) return aliased;
  }

  const plural = resolve(
    targets.filter(({ key }) => singular(key) === singular(rawKey)),
    (candidate) => ({ status: "matched", kind: "plural", candidate }),
  );
  if (plural) return plural;

  if (!LETTERS_ONLY.test(rawKey)) return NONE;
  const lettered = targets.filter(({ key }) => LETTERS_ONLY.test(key));

  const abbreviation = resolve(
    lettered.filter(({ key }) =>
      rawKey.length >= 2 && key[0] === rawKey[0] &&
      (isSubsequence(rawKey, key) || isSubsequence(key, rawKey))
    ),
    (candidate) => ({
      status: "suggested",
      kind: "abbreviation",
      candidate,
      score: 0.85,
    }),
  );
  if (abbreviation) return abbreviation;

  const scored = lettered
    .map((target) => ({
      target,
      score: stringSimilarity(rawKey, target.key),
    }))
    .filter(({ score }) => score >= SIMILAR_THRESHOLD)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) return NONE;
  // Two close spellings with nearly the same score: let the reviewer choose.
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.1) {
    return {
      status: "ambiguous",
      candidates: scored.map(({ target }) => target.value),
    };
  }
  return {
    status: "suggested",
    kind: "similar",
    candidate: scored[0].target.value,
    score: scored[0].score,
  };
}

/** Phase: "MDL", "Model" and "Models" find the Phase named "MODELS". */
export function matchPhase<T extends { code: string }>(
  phaseRaw: string,
  phases: T[],
  aliases?: AliasMap,
) {
  return matchKey(
    normalizePhaseKey(phaseRaw),
    phases.map((value) => ({ key: normalizePhaseKey(value.code), value })),
    aliases,
  );
}

/** Lot: only the same number matches ("027" and "27" are the same Lot). */
export function matchLot<T extends { lotNumber: string }>(
  lotRaw: string,
  lots: T[],
  aliases?: AliasMap,
) {
  return matchKey(
    normalizeLotKey(lotRaw),
    lots.map((value) => ({ key: normalizeLotKey(value.lotNumber), value })),
    aliases,
  );
}

/**
 * Plan: the system's Plan carries the elevation ("4B"), so "Plan: 4" +
 * "Elevation: B" is tried as "4B" first. When the system has no such Plan the
 * bare "4" is tried and the result says the elevation was not used.
 */
export function matchPlan<T extends { code: string }>(
  planRaw: string,
  elevationRaw: string | null,
  plans: T[],
  aliases?: AliasMap,
): Match<T> {
  const targets = plans.map((value) => ({
    key: planKeyCandidates(value.code, null)[0] ?? "",
    value,
  }));
  const [combined, ...fallbacks] = planKeyCandidates(planRaw, elevationRaw);
  if (combined === undefined) return NONE;

  const first = matchKey(combined, targets, aliases);
  if (first.status !== "none" || fallbacks.length === 0) return first;

  const bare = matchKey(fallbacks[0], targets, aliases);
  return bare.status === "matched"
    ? { ...bare, kind: "elevation_ignored" }
    : bare;
}

/**
 * Whether what a PO prints for the Plan is the Plan of a Lot: the same number, the
 * same elevation and the same ADA version. Mirrored ("CR" for "C") and the spec the
 * system adds ("2B STC32" for "2B") do not make it another Plan; a different
 * elevation ("3A" for "3B") or no elevation to compare does.
 */
export function planFitsLotPlan(
  planRaw: string,
  elevationRaw: string | null,
  lotPlanCode: string,
) {
  const printed = planParts(planRaw, elevationRaw);
  const lot = planParts(lotPlanCode);
  return printed.base !== "" && printed.base === lot.base &&
    printed.elevation === lot.elevation && printed.ada === lot.ada;
}

/** 0 to 1: how much of the meaning two descriptions share (words, not letters). */
export function descriptionSimilarity(left: string, right: string) {
  const a = new Set(descriptionTokens(left));
  const b = new Set(descriptionTokens(right));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

export interface OptionCandidate {
  code: string;
  name: string;
  description: string | null;
}

// Below this, an option with the right code probably describes other work.
export const DESCRIPTION_DIFFERS_BELOW = 0.5;
const PICK_AT_LEAST = 0.6;
const PICK_LEAD = 0.15;

export type OptionMatch<T> =
  | {
    status: "matched";
    candidate: T;
    similarity: number;
    // The code fits but the description reads like other work.
    descriptionDiffers: boolean;
  }
  | { status: "ambiguous"; candidates: T[] }
  | { status: "missing" };

/**
 * Finds the Plan's option for a printed code. The same code may exist more than
 * once under a Plan when each row describes different work, so several candidates
 * are told apart by their description, and only when one is clearly the best.
 */
export function matchOption<T extends OptionCandidate>(
  codeRaw: string,
  descriptionLines: string[],
  options: T[],
): OptionMatch<T> {
  const key = normalizeOptionCode(codeRaw);
  const candidates = options.filter((option) =>
    key !== "" && normalizeOptionCode(option.code) === key
  );
  if (candidates.length === 0) return { status: "missing" };

  const printed = descriptionLines.join(" ");
  const scored = candidates
    .map((candidate) => ({
      candidate,
      similarity: descriptionSimilarity(
        printed,
        [candidate.name, candidate.description ?? ""].join(" "),
      ),
    }))
    .sort((left, right) => right.similarity - left.similarity);

  const [best, next] = scored;
  if (candidates.length === 1) {
    return {
      status: "matched",
      candidate: best.candidate,
      similarity: best.similarity,
      descriptionDiffers: best.similarity < DESCRIPTION_DIFFERS_BELOW,
    };
  }

  const clear = best.similarity >= PICK_AT_LEAST &&
    best.similarity - next.similarity >= PICK_LEAD;
  return clear
    ? {
      status: "matched",
      candidate: best.candidate,
      similarity: best.similarity,
      descriptionDiffers: false,
    }
    : { status: "ambiguous", candidates: scored.map((item) => item.candidate) };
}
