import { groupRows, parseMoneyCents } from "./paymentScheduleTypes.ts";
import type { ScheduleRow } from "./paymentScheduleTypes.ts";
import type { PageContent, TextRun } from "./releaseTypes.ts";

// Reading a Payment Schedule with AI, for the layouts no parser knows.
//
// The model never writes an amount. Every amount printed in the PDF is tagged with a
// reference ([#12]) in the text the model reads, and the model answers with those
// references: "the amount [#12] is Lot 001, draw 2". The amount, the page and the
// highlight then come from the PDF itself, and paymentScheduleAiVerify.ts checks
// every answer against the PDF and the Job before anyone sees it. A wrong answer can
// point at the wrong amount, never at an amount that is not printed.
//
// Only the person's explicit request sends a document: the text of the PDF and the
// Job's draws, Lots, Plans and prices go to the model. Nothing is logged here.

export const AI_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
export const AI_DEFAULT_MODEL = "mistral-large-latest";
export const AI_TIMEOUT_MS = 120_000;
// Past this the document does not fit the model comfortably: about 50k tokens.
export const MAX_DOCUMENT_CHARS = 180_000;
// About 60 tokens per Lot for the answer, plus room for a model that reasons first.
const MAX_ANSWER_TOKENS = 16_000;

export class PaymentScheduleAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentScheduleAiError";
  }
}

// --- What the model reads -----------------------------------------------------

/** One amount printed in the PDF, as the model can point at it. */
export interface AmountRef {
  ref: string;
  cents: number;
  page: PageContent;
  run: TextRun;
  // The line the amount sits on: a cell highlights the whole line.
  row: ScheduleRow;
}

export interface AiDocument {
  text: string;
  refs: Map<string, AmountRef>;
  // Every word of the document, for checking that a printed Phase or code exists.
  words: Set<string>;
}

// "L o t :" and "0 0 1": some PDFs space every letter. Three or more single
// characters in a row read as one word.
const LETTER_SPACED = /^(?:\S )+\S$/u;

export function collapseLetterSpacing(text: string) {
  const value = text.trim();
  return LETTER_SPACED.test(value) && value.length >= 5 ? value.replace(/ /gu, "") : value;
}

export function wordKey(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.]/gu, "");
}

/** The text of the PDF, line by line, with a reference after every amount. */
export function buildAiDocument(pages: PageContent[]): AiDocument {
  const refs = new Map<string, AmountRef>();
  const words = new Set<string>();
  const lines: string[] = [];

  for (const page of pages) {
    lines.push(`=== Page ${page.page} ===`);
    for (const row of groupRows(page.runs)) {
      const parts = row.runs.map((run) => {
        const text = collapseLetterSpacing(run.text);
        for (const word of text.split(/\s+/u)) {
          const key = wordKey(word);
          if (key !== "") words.add(key);
        }
        const cents = parseMoneyCents(text);
        if (cents === null) return text;
        const ref = `#${refs.size + 1}`;
        refs.set(ref, { ref, cents, page, run, row });
        return `${text} [${ref}]`;
      });
      lines.push(parts.join(" | "));
    }
  }

  const text = lines.join("\n");
  if (text.length > MAX_DOCUMENT_CHARS) {
    throw new PaymentScheduleAiError(
      "This PDF is too long to be read with AI. Split it into smaller PDFs, one per Phase.",
    );
  }
  return { text, refs, words };
}

// --- What the model knows about the Job ----------------------------------------

export interface AiJobDraw {
  draw: number;
  name: string;
  // Share of the Lot price, 0 to 100.
  percentage: number | null;
}

export interface AiJobLot {
  phase: string;
  lot: string;
  plan: string | null;
  // Price of the Lot's Plan, in cents.
  priceCents: number | null;
  // The utility building of the Phase: its price is shared by the Phase's Lots.
  utility: boolean;
}

export interface AiJobContext {
  draws: AiJobDraw[];
  lots: AiJobLot[];
}

function money(cents: number | null) {
  return cents === null ? "no price" : `$${(cents / 100).toFixed(2)}`;
}

export function describeJob(context: AiJobContext) {
  const draws = [...context.draws].sort((a, b) => a.draw - b.draw).map((draw) =>
    `- Draw ${draw.draw}: ${draw.name}${
      draw.percentage === null ? "" : ` (${draw.percentage}% of the Lot price)`
    }`
  );

  const phases = new Map<string, AiJobLot[]>();
  for (const lot of context.lots) {
    phases.set(lot.phase, [...(phases.get(lot.phase) ?? []), lot]);
  }
  const lots = [...phases.entries()].map(([phase, entries]) => {
    const homes = entries.filter((lot) => !lot.utility);
    const utility = entries.filter((lot) => lot.utility);
    const lines = homes.map((lot) =>
      `  - Lot ${lot.lot}: Plan ${lot.plan ?? "?"}, ${money(lot.priceCents)}`
    );
    for (const building of utility) {
      lines.push(
        `  - Utility building: ${money(building.priceCents)}, shared by the ${homes.length} Lots of this Phase`,
      );
    }
    return [`Phase ${phase}:`, ...lines].join("\n");
  });

  return [
    "Draws of the Job's Billing Setup:",
    ...draws,
    "",
    "Lots of the Job:",
    ...lots,
  ].join("\n");
}

// --- The request -----------------------------------------------------------------

const INSTRUCTIONS = [
  "You read Payment Schedules that home builders send to a finish carpentry subcontractor.",
  "A Payment Schedule says how much the builder pays for each Lot at each draw (stage of the work).",
  "Builders lay them out in many ways: a table with a column per draw, a list with a row per Lot and draw,",
  "or a purchase order report with one purchase order per Lot and activity.",
  "",
  "You get the Job's draws and Lots, then the text of the PDF line by line, with ' | ' between pieces of text.",
  "Every amount in the text is followed by a reference such as [#12].",
  "",
  "Find, for every Lot in the PDF, the amount of each draw, and the Utility amount when there is one.",
  "Rules:",
  "- Answer with references only. Never write an amount, never invent a reference.",
  "- Match a draw by its name, its activity or cost code, or its share of the Lot price. Use the Job's draw numbers.",
  "- When the same amount is printed twice for one Lot and draw (a purchase order total and its line), use the line.",
  "- Utility: an amount for the utility building or utility closet that the Lots of a Phase share.",
  "  Builders often split the utility building price evenly among the Lots of the Phase and bill it on each Lot.",
  "- Leave out totals of several Lots, options, taxes and anything that is not a draw or the Utility.",
  "- Write the Lot exactly as printed. Write the Phase only when the PDF prints one for that Lot, else null.",
  "",
  "Reply with JSON only, in this shape:",
  '{"lots": [{"lot": "001", "phase": null, "draws": [{"draw": 1, "ref": "#3"}], "utility": "#9"}],',
  ' "drawLabels": [{"draw": 1, "label": "text the PDF uses for this draw", "code": "printed activity code or null"}],',
  ' "notes": ["short remarks about how this PDF is laid out or anything you could not place"]}',
  'Use "utility": null when a Lot has no Utility amount.',
].join("\n");

export function buildAiRequest(document: AiDocument, context: AiJobContext, model: string) {
  return {
    model,
    // Greedy: the same PDF gives the same answer. Mistral rejects greedy sampling unless
    // top_p is 1, and some models default it lower.
    temperature: 0,
    top_p: 1,
    max_tokens: MAX_ANSWER_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INSTRUCTIONS },
      {
        role: "user",
        content: `${describeJob(context)}\n\nText of the PDF:\n${document.text}`,
      },
    ],
  };
}

// --- The answer ------------------------------------------------------------------

export interface AiLotAnswer {
  lot: string;
  phase: string | null;
  draws: Array<{ draw: number; ref: string }>;
  utility: string | null;
}

export interface AiAnswer {
  lots: AiLotAnswer[];
  drawLabels: Array<{ draw: number; label: string | null; code: string | null }>;
  notes: string[];
}

const REF = /^#\d+$/u;

function text(value: unknown, max = 200) {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : null;
}

function ref(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^\[|\]$/gu, "");
  return REF.test(cleaned) ? cleaned : null;
}

/** The model's JSON, keeping only what has the expected shape. */
export function parseAiAnswer(content: unknown): AiAnswer {
  if (typeof content !== "string") {
    throw new PaymentScheduleAiError("The AI gave no answer. Try again.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/gu, ""));
  } catch {
    throw new PaymentScheduleAiError("The AI answer could not be read. Try again.");
  }
  const root = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;

  const lots: AiLotAnswer[] = [];
  for (const item of Array.isArray(root.lots) ? root.lots : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const lot = text(entry.lot, 40);
    if (!lot) continue;
    const draws = (Array.isArray(entry.draws) ? entry.draws : []).flatMap((value) => {
      const draw = (value ?? {}) as Record<string, unknown>;
      const number = Number(draw.draw);
      const target = ref(draw.ref);
      return Number.isInteger(number) && number >= 1 && number <= 5 && target
        ? [{ draw: number, ref: target }]
        : [];
    });
    lots.push({ lot, phase: text(entry.phase, 40), draws, utility: ref(entry.utility) });
  }

  const drawLabels = (Array.isArray(root.drawLabels) ? root.drawLabels : []).flatMap((value) => {
    const label = (value ?? {}) as Record<string, unknown>;
    const draw = Number(label.draw);
    return Number.isInteger(draw) && draw >= 1 && draw <= 5
      ? [{ draw, label: text(label.label, 120), code: text(label.code, 40) }]
      : [];
  });

  const notes = (Array.isArray(root.notes) ? root.notes : [])
    .flatMap((note) => {
      const value = text(note, 300);
      return value ? [value] : [];
    })
    .slice(0, 6);

  return { lots, drawLabels, notes };
}

// --- The call --------------------------------------------------------------------

/**
 * The text of a chat answer. Mistral sends a plain string, or, for models that reason
 * first, a list of chunks: "thinking" chunks with the reasoning and "text" chunks with
 * the answer. Only the "text" chunks are the answer.
 */
export function answerText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() === "" ? null : content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((chunk) => chunk && typeof chunk === "object" && (chunk as { type?: unknown }).type === "text")
    .map((chunk) => (chunk as { text?: unknown }).text)
    .filter((value): value is string => typeof value === "string")
    .join("");
  return text.trim() === "" ? null : text;
}

/** The short reason an AI provider gives for rejecting a request, if it gives one. */
export function providerErrorDetail(payload: unknown) {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const raw = body.message ?? (body.error as Record<string, unknown> | undefined)?.message ?? body.detail;
  const message = typeof raw === "string" ? raw : raw === undefined ? "" : JSON.stringify(raw);
  return message.replace(/\s+/gu, " ").trim().slice(0, 240);
}

export interface AiReader {
  model: string;
  read(document: AiDocument, context: AiJobContext): Promise<AiAnswer>;
}

export function mistralScheduleReader(options: {
  apiKey: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): AiReader {
  const model = options.model?.trim() || AI_DEFAULT_MODEL;
  return {
    model,
    async read(document, context) {
      let response: Response;
      try {
        response = await (options.fetcher ?? fetch)(AI_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildAiRequest(document, context, model)),
          signal: AbortSignal.timeout(options.timeoutMs ?? AI_TIMEOUT_MS),
        });
      } catch {
        throw new PaymentScheduleAiError(
          "The AI did not answer in time. Try again in a moment.",
        );
      }
      if (!response.ok) {
        if (response.status === 429) {
          throw new PaymentScheduleAiError("The AI is busy. Try again in a minute.");
        }
        // Mistral says what it rejected ("Invalid model", a parameter out of range). The
        // reason is shown to the person, who may see the document, and never logged.
        const detail = providerErrorDetail(await response.json().catch(() => null));
        throw new PaymentScheduleAiError(
          `The AI could not read this PDF (error ${response.status}${detail ? `: ${detail}` : ""}).`,
        );
      }

      const payload = await response.json().catch(() => null) as
        | { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> }
        | null;
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new PaymentScheduleAiError(
          "The AI answer was cut off before it finished. Split the PDF into smaller PDFs, one per Phase.",
        );
      }
      const content = answerText(choice?.message?.content);
      if (content === null) {
        throw new PaymentScheduleAiError(
          `The AI gave no answer${
            choice?.finish_reason ? ` (it stopped with "${String(choice.finish_reason).slice(0, 40)}")` : ""
          }. Try again.`,
        );
      }
      return parseAiAnswer(content);
    },
  };
}
