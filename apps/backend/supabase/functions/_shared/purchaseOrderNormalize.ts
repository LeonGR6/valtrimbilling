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
