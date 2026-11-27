import { runsRect } from "./paymentScheduleGeometry.ts";
import { normalizeCodeKey } from "./paymentScheduleTypes.ts";
import type { ScheduleRect } from "./paymentScheduleTypes.ts";
import type { AiAnswer, AiDocument, AiLine } from "./paymentScheduleAi.ts";

// Remembered layouts ("recipes"): how a builder's Payment Schedule is read without AI.
//
// Learned once, from a schedule the AI read and a person confirmed: for each draw and
// the Utility, the text that every one of its lines prints and no other line of the
// schedule does ("40-240-10"), and the label the Lot follows ("Lot:"). Read later by
// walking the lines: a label line sets the current Lot, a line with a draw's text gives
// that Lot's amount for the draw (the last amount on the line).
//
// A recipe is kept only when reading the very PDF it was learned from gives back the
// confirmed amounts exactly. Its answer has the AI's shape, so it goes through the
// same checks against the PDF and the Job before anyone sees it. Pure: no network.

export interface RecipeRules {
  version: 1;
  kind: "line_code";
  // Text the layout prints, to tell it from the builder's other layouts.
  signature: string[];
  // The piece that comes right before the Lot.
  lotLabel: string;
  draws: Array<{ draw: number; key: string }>;
  utility: { key: string } | null;
}

export interface LearnedRecipe {
  rules: RecipeRules;
  signatureKey: string;
}

/** A confirmed cell, as the mapping stores it. */
export interface ConfirmedCell {
  lot: string;
  draw?: number;
  amount: number;
  page: number;
  rect: ScheduleRect;
}

export class RecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeError";
  }
}

const SIGNATURE_PIECES = 4;
const SIGNATURE_LINES = 10;
// How far the center of a line may sit outside the confirmed box (normalized page).
const BOX_SLACK = 0.003;

export function pieceKey(text: string) {
  return text.trim().replace(/\s+/gu, " ").toUpperCase();
}

const hasDigit = (text: string) => /\d/u.test(text);

// --- Reading -----------------------------------------------------------------------

/** Whether the document prints what the recipe was learned from. */
export function recipeMatches(document: AiDocument, rules: RecipeRules) {
  const keys = new Set(document.lines.flatMap((line) => line.pieces.map(pieceKey)));
  return rules.signature.every((piece) => keys.has(pieceKey(piece))) &&
    keys.has(pieceKey(rules.lotLabel)) &&
    rules.draws.some(({ key }) => keys.has(pieceKey(key)));
}

/** The answer a remembered layout gives for a document, or null when it does not fit. */
export function readWithRecipe(document: AiDocument, rules: RecipeRules): AiAnswer | null {
  if (!recipeMatches(document, rules)) return null;

  const label = pieceKey(rules.lotLabel);
  const drawByKey = new Map(rules.draws.map(({ draw, key }) => [pieceKey(key), draw]));
  const utilityKey = rules.utility ? pieceKey(rules.utility.key) : null;
  const lots = new Map<string, AiAnswer["lots"][number]>();
  let lot: string | null = null;

  for (const line of document.lines) {
    const keys = line.pieces.map(pieceKey);
    const at = keys.indexOf(label);
    if (at >= 0 && line.pieces[at + 1]) lot = line.pieces[at + 1].trim();
    if (!lot || line.refs.length === 0) continue;

    const amount = line.refs[line.refs.length - 1];
    const draw = keys.map((key) => drawByKey.get(key)).find((value) => value !== undefined);
    const isUtility = utilityKey !== null && keys.includes(utilityKey);
    if (draw === undefined && !isUtility) continue;

    const entry = lots.get(lot) ?? { lot, phase: null, draws: [], utility: null };
    if (draw !== undefined) entry.draws.push({ draw, ref: amount });
    else entry.utility = amount;
    lots.set(lot, entry);
  }

  if (lots.size === 0) return null;
  return {
    lots: [...lots.values()],
    drawLabels: rules.draws.map(({ draw, key }) => ({ draw, label: null, code: key })),
    notes: [],
  };
}

// --- Learning ----------------------------------------------------------------------

function lineRect(line: AiLine) {
  return runsRect(line.row.runs, line.page);
}

/** The line a confirmed cell highlights: on its page, printing its amount, inside its box. */
function findLine(document: AiDocument, cell: ConfirmedCell) {
  const cents = Math.round(cell.amount * 100);
  const found = document.lines.filter((line) => {
    if (line.page.page !== cell.page) return false;
    if (!line.refs.some((ref) => document.refs.get(ref)?.cents === cents)) return false;
    const rect = lineRect(line);
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    return x >= cell.rect.x - BOX_SLACK && x <= cell.rect.x + cell.rect.w + BOX_SLACK &&
      y >= cell.rect.y - BOX_SLACK && y <= cell.rect.y + cell.rect.h + BOX_SLACK;
  });
  if (found.length !== 1) {
    throw new RecipeError(
      `The line of Lot ${cell.lot}${cell.draw ? `, draw ${cell.draw}` : " (Utility)"} on page ${cell.page} could not be found.`,
    );
  }
  return found[0];
}

/**
 * The text that every line of a group prints and no line of the other groups does,
 * preferring the one the rest of the document prints least (a code over a word).
 */
function distinctiveKey(
  group: AiLine[],
  others: AiLine[],
  document: AiDocument,
  name: string,
) {
  const first = group[0];
  const shared = first.pieces.filter((piece) => {
    const key = pieceKey(piece);
    return key !== "" &&
      !first.refs.some((ref) => pieceKey(document.refs.get(ref)!.run.text) === key) &&
      group.every((line) => line.pieces.some((other) => pieceKey(other) === key)) &&
      !others.some((line) => line.pieces.some((other) => pieceKey(other) === key));
  });
  if (shared.length === 0) {
    throw new RecipeError(`No text tells the lines of ${name} apart from the others.`);
  }

  const uses = (piece: string) =>
    document.lines.filter((line) => line.pieces.some((other) => pieceKey(other) === pieceKey(piece)))
      .length;
  return shared
    .map((piece, index) => ({ piece, index, uses: uses(piece) }))
    .sort((a, b) => a.uses - b.uses || a.index - b.index)[0].piece.trim();
}

/** The piece printed right before the Lot, the same for every cell. */
function findLotLabel(document: AiDocument, cells: Array<{ cell: ConfirmedCell; line: AiLine }>) {
  const labels = new Set<string>();
  for (const { cell, line } of cells) {
    const lot = cell.lot.trim();
    let index = document.lines.indexOf(line);
    let label: string | null = null;
    for (; index >= 0 && label === null; index -= 1) {
      const pieces = document.lines[index].pieces;
      const at = pieces.findIndex((piece, position) =>
        position > 0 && piece.trim() === lot && !hasDigit(pieces[position - 1])
      );
      if (at > 0) label = pieces[at - 1].trim();
    }
    if (label === null) {
      throw new RecipeError(`Lot ${cell.lot} is not printed after a label above its amounts.`);
    }
    labels.add(label);
  }
  if (labels.size !== 1) {
    throw new RecipeError("The Lots are not always printed after the same label.");
  }
  return [...labels][0];
}

/** Text the first lines print, without digits: what this layout says about itself. */
function findSignature(document: AiDocument, exclude: Set<string>) {
  const signature: string[] = [];
  const firstPage = document.lines[0]?.page.page;
  for (const line of document.lines.filter((line) => line.page.page === firstPage).slice(0, SIGNATURE_LINES)) {
    for (const piece of line.pieces) {
      const text = piece.trim();
      if (
        text.length >= 4 && !hasDigit(text) && !exclude.has(pieceKey(text)) &&
        !signature.some((kept) => pieceKey(kept) === pieceKey(text))
      ) {
        signature.push(text);
      }
      if (signature.length === SIGNATURE_PIECES) return signature;
    }
  }
  return signature;
}

function cellSet(entries: Array<{ lot: string; draw: number | "U"; cents: number }>) {
  return entries.map(({ lot, draw, cents }) => `${normalizeCodeKey(lot)}|${draw}|${cents}`).sort();
}

/**
 * Learns how the layout is read from the confirmed cells and Utility amounts of a
 * schedule. Throws RecipeError, with the reason, when it cannot be learned exactly.
 */
export function learnRecipe(
  document: AiDocument,
  mapping: { cells: ConfirmedCell[]; utilityCells?: ConfirmedCell[] },
): LearnedRecipe {
  const cells = mapping.cells.filter((cell) => typeof cell.draw === "number");
  if (cells.length === 0) throw new RecipeError("The schedule has no confirmed amounts.");
  const utilityCells = mapping.utilityCells ?? [];

  const located = cells.map((cell) => ({ cell, line: findLine(document, cell) }));
  const utilityLocated = utilityCells.map((cell) => ({ cell, line: findLine(document, cell) }));

  const byDraw = new Map<number, AiLine[]>();
  for (const { cell, line } of located) byDraw.set(cell.draw!, [...(byDraw.get(cell.draw!) ?? []), line]);
  const groups = [...byDraw.entries()].sort(([a], [b]) => a - b);
  const utilityLines = utilityLocated.map(({ line }) => line);

  const draws = groups.map(([draw, lines]) => ({
    draw,
    key: distinctiveKey(
      lines,
      [...groups.filter(([other]) => other !== draw).flatMap(([, other]) => other), ...utilityLines],
      document,
      `draw ${draw}`,
    ),
  }));
  const utility = utilityLines.length > 0
    ? { key: distinctiveKey(utilityLines, groups.flatMap(([, lines]) => lines), document, "the Utility") }
    : null;

  const lotLabel = findLotLabel(document, [...located, ...utilityLocated]);
  const exclude = new Set([lotLabel, ...draws.map(({ key }) => key), ...(utility ? [utility.key] : [])].map(pieceKey));
  const rules: RecipeRules = {
    version: 1,
    kind: "line_code",
    signature: findSignature(document, exclude),
    lotLabel,
    draws,
    utility,
  };

  // Kept only when it gives back exactly what was confirmed.
  const answer = readWithRecipe(document, rules);
  const read = answer?.lots.flatMap((entry) => [
    ...entry.draws.map(({ draw, ref }) => ({ lot: entry.lot, draw, cents: document.refs.get(ref)!.cents })),
    ...(entry.utility
      ? [{ lot: entry.lot, draw: "U" as const, cents: document.refs.get(entry.utility)!.cents }]
      : []),
  ]) ?? [];
  const expected = [
    ...cells.map((cell) => ({ lot: cell.lot, draw: cell.draw!, cents: Math.round(cell.amount * 100) })),
    ...utilityCells.map((cell) => ({ lot: cell.lot, draw: "U" as const, cents: Math.round(cell.amount * 100) })),
  ];
  if (JSON.stringify(cellSet(read)) !== JSON.stringify(cellSet(expected))) {
    throw new RecipeError(
      "Reading the schedule with what was learned does not give back the confirmed amounts exactly.",
    );
  }

  return {
    rules,
    signatureKey: [
      ...rules.signature.map(pieceKey),
      `LOT=${pieceKey(lotLabel)}`,
      ...draws.map(({ draw, key }) => `${draw}=${pieceKey(key)}`),
    ].join("|").slice(0, 1000),
  };
}

/** The rules as stored, or null when they do not have the expected shape. */
export function parseRecipeRules(value: unknown): RecipeRules | null {
  if (!value || typeof value !== "object") return null;
  const rules = value as Record<string, unknown>;
  if (rules.version !== 1 || rules.kind !== "line_code") return null;
  if (typeof rules.lotLabel !== "string" || rules.lotLabel.trim() === "") return null;
  if (!Array.isArray(rules.signature) || !rules.signature.every((piece) => typeof piece === "string")) {
    return null;
  }
  if (!Array.isArray(rules.draws) || rules.draws.length === 0) return null;
  const draws = rules.draws.flatMap((entry) => {
    const draw = (entry ?? {}) as Record<string, unknown>;
    return Number.isInteger(draw.draw) && typeof draw.key === "string" && draw.key.trim() !== ""
      ? [{ draw: draw.draw as number, key: draw.key }]
      : [];
  });
  if (draws.length !== rules.draws.length) return null;
  const utility = rules.utility && typeof (rules.utility as Record<string, unknown>).key === "string"
    ? { key: (rules.utility as { key: string }).key }
    : null;
  return {
    version: 1,
    kind: "line_code",
    signature: rules.signature as string[],
    lotLabel: rules.lotLabel,
    draws,
    utility,
  };
}
