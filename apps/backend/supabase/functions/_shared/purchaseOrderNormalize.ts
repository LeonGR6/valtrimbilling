import { normalizeCodeKey } from "./paymentScheduleTypes.ts";

// Keys to compare what a Purchase Order prints with what the system holds. Pure
// functions. A builder's PDF says "MDL" where the system says "MODELS", or
// "Phase 4" where it says "4"; these reduce both sides to the same comparable text.
// Deciding whether two keys are "the same" lives in purchaseOrderMatch.ts.

/** Uppercase without accents ("Fábrica" -> "FABRICA"). */
function fold(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

function alphanumeric(value: string) {
  return value.replace(/[^A-Z0-9]/gu, "");
}

// A leading word that only labels the value ("Phase 4", "Lot #12"). It must be
// followed by a non-letter so "PHOENIX" is not read as "PH" + "OENIX".
function stripLabel(folded: string, labels: string[]) {
  const pattern = new RegExp(
    `^(?:${labels.join("|")})(?![A-Z])[\\s.#:-]*`,
    "u",
  );
  return folded.replace(pattern, "");
}

/** Phase: "Phase 4" and "4" -> "4"; "Models" -> "MODELS"; "MDL" -> "MDL". */
export function normalizePhaseKey(value: string) {
  return normalizeCodeKey(
    alphanumeric(stripLabel(fold(value), ["PHASE", "FASE", "PH"])),
  );
}

/** Lot: "Lot 027", "#27" and "27" -> "27"; "01A" -> "1A". */
export function normalizeLotKey(value: string) {
  return normalizeCodeKey(
    alphanumeric(stripLabel(fold(value), ["LOT/UNIT", "LOT", "UNIT", "LT"])),
  );
}

/** Plan: "Plan 4B" and "4b" -> "4B". */
export function normalizePlanKey(value: string) {
  return normalizeCodeKey(alphanumeric(stripLabel(fold(value), ["PLAN"])));
}

/**
 * The keys a printed Plan can match, best first. The system names a Plan with its
 * elevation ("4B") while the PDF prints them apart ("Plan: 4", "Elevation: B"),
 * so the combined key goes first and the bare Plan is the fallback.
 */
export function planKeyCandidates(
  planRaw: string,
  elevationRaw: string | null,
) {
  const plan = normalizePlanKey(planRaw);
  const elevation = elevationRaw ? alphanumeric(fold(elevationRaw)) : "";
  const keys = elevation !== "" ? [`${plan}${elevation}`, plan] : [plan];
  return [...new Set(keys.filter((key) => key !== ""))];
}

export interface PlanParts {
  /** The Plan number: "4", "67", "4.1". Empty when the text does not start with one. */
  base: string;
  /** The elevation letter ("B"), or "" when there is none. A trailing R is not part of it. */
  elevation: string;
  /** The accessible (ADA) version of the Plan. */
  ada: boolean;
}

/**
 * What a Plan says, apart from the notation around it, so a PO and the system can
 * be compared by meaning:
 *   - a PO prints the Plan and the elevation apart ("4" + "CR"), the system joins
 *     them ("4C"), and an elevation may be written "B-R" or "BR";
 *   - the R after the elevation is the same Plan mirrored (reverse), not another one;
 *   - ADA is its own version of a Plan ("3B-ADA");
 *   - whatever else the system adds after the elevation ("STC32", "B200A") says which
 *     spec the Lot was built to, which a PO does not print, so it is ignored.
 * "4" + "CR", "4CR" and "4C STC32" are all Plan 4, elevation C.
 */
export function planParts(
  planRaw: string,
  elevationRaw: string | null = null,
): PlanParts {
  const plan = stripLabel(fold(planRaw), ["PLAN"]).trim();
  const text = `${plan}${fold(elevationRaw ?? "").trim()}`;

  const match = /^(\d+(?:\.\d+)?)([A-Z]*)/u.exec(text);
  if (!match) return { base: "", elevation: "", ada: false };

  let elevation = match[2];
  let ada = /(?:^|[^A-Z])ADA(?![A-Z])/u.test(text.slice(match[1].length));
  if (elevation.endsWith("ADA")) {
    ada = true;
    elevation = elevation.slice(0, -3);
  }
  // "CR" is C reversed; a lone "R" is left as it is.
  if (elevation.length >= 2 && elevation.endsWith("R")) {
    elevation = elevation.slice(0, -1);
  }
  return { base: match[1], elevation, ada };
}

/** Option code: "2FIN-5006", "2fin 5006" and "2FIN5006" are the same code. */
export function normalizeOptionCode(value: string) {
  return alphanumeric(fold(value));
}

const STOP_WORDS = new Set([
  "A",
  "AN",
  "THE",
  "OF",
  "AND",
  "AT",
  "WITH",
  "FOR",
  "TO",
  "IN",
  "ON",
  "OR",
]);

/**
 * The words that carry the meaning of a description: no accents, punctuation or
 * filler words, and a plural counts as its singular.
 */
export function descriptionTokens(value: string) {
  const tokens = fold(value)
    .replace(/[^A-Z0-9]+/gu, " ")
    .split(" ")
    .filter((token) => token !== "" && !STOP_WORDS.has(token))
    .map((token) =>
      token.length > 3 && token.endsWith("S") ? token.slice(0, -1) : token
    );
  return [...new Set(tokens)];
}

const NAME_MAX = 300;
const DESCRIPTION_MAX = 300;

/**
 * The first printed line is the option's name (it becomes the billing line) and
 * the rest its description, both cut to what the database accepts.
 */
export function optionNameAndDescription(descriptionLines: string[]) {
  const lines = descriptionLines.map((line) => line.trim()).filter((line) =>
    line !== ""
  );
  return {
    name: (lines[0] ?? "").slice(0, NAME_MAX),
    description: lines.length > 1
      ? lines.slice(1).join(" · ").slice(0, DESCRIPTION_MAX)
      : null,
  };
}
