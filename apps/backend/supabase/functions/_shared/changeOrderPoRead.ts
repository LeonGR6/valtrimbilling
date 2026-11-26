import { groupRows } from "./paymentScheduleTypes.ts";
import { answerText, collapseLetterSpacing, providerErrorDetail } from "./paymentScheduleAi.ts";
import type { ReleasePdfContent } from "./releasePdf.ts";

// Reading the builders' Purchase Orders of the Extras / Change Orders.
//
// A PDF can hold several orders (a Purchase Order, a Change Order, a customer service Work Order, a Field
// PO, an Olson Contract), each of them over one or more pages, for one Lot or many. The text of the PDF is
// read (pages without text, a scan, are read with OCR) and an AI model says where each order is and what
// it says. The model never writes an amount: every amount printed in the PDF is tagged with a reference
// ([#12]) and the model answers with those. Every number it gives (the order number, the Lots) is checked
// against the printed text, and what cannot be checked is dropped or flagged before anyone sees it.
//
// Nothing from a document is logged here.

export const AI_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
export const OCR_ENDPOINT = "https://api.mistral.ai/v1/ocr";
export const AI_DEFAULT_MODEL = "mistral-large-latest";
// Asked once more when the first model stalls or runs away; it answers faster.
export const AI_FALLBACK_MODEL = "mistral-medium-latest";
export const OCR_MODEL = "mistral-ocr-latest";
export const AI_TIMEOUT_MS = 110_000;
// The answer streams in; this long without a new piece means the model stalled.
export const AI_IDLE_MS = 30_000;
// A second try is only worth starting with at least this much time left.
const MIN_RETRY_MS = 30_000;
// In JSON mode a model sometimes writes blanks without end instead of closing the answer.
const MAX_BLANK_RUN = 400;
export const MAX_DOCUMENT_CHARS = 180_000;
const MAX_ANSWER_TOKENS = 16_000;
const MAX_ORDERS = 60;
const MAX_LINES = 500;
const MAX_RANGE = 500;
// A page with less text than this is taken as a scan.
const MIN_PAGE_TEXT = 20;

export const ORDER_KINDS = [
  "PURCHASE_ORDER",
  "CHANGE_ORDER",
  "WORK_ORDER",
  "FIELD_PO",
  "CONTRACT",
  "OTHER",
] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export class ChangeOrderPoReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeOrderPoReadError";
  }
}

// --- The text of the PDF -------------------------------------------------------------

export interface PoPage {
  page: number;
  lines: string[];
  source: "text" | "ocr";
}

/** Each page as lines of text, left to right and top to bottom. */
export function pagesFromPdf(content: ReleasePdfContent): PoPage[] {
  const pages: PoPage[] = content.pageSizes.map((size) => ({ page: size.page, lines: [], source: "text" }));
  for (const page of content.pages) {
    const target = pages.find((candidate) => candidate.page === page.page);
    if (!target) continue;
    target.lines = groupRows(page.runs).map((row) =>
      row.runs.map((run) => collapseLetterSpacing(run.text)).join(" ").replace(/\s+/gu, " ").trim()
    ).filter((line) => line !== "");
  }
  return pages;
}

/** The pages with (almost) no text: scans, which only OCR can read. */
export function pagesWithoutText(pages: PoPage[]) {
  return pages
    .filter((page) => page.lines.join("").replace(/\s/gu, "").length < MIN_PAGE_TEXT)
    .map((page) => page.page);
}

/** Puts the OCR text in the pages that had none. `ocr` is in page order, 0-based `index`. */
export function withOcrText(pages: PoPage[], ocr: Array<{ index: number; markdown: string }>, onlyPages: number[]) {
  const wanted = new Set(onlyPages);
  return pages.map((page) => {
    if (!wanted.has(page.page)) return page;
    const found = ocr.find((candidate) => candidate.index === page.page - 1);
    if (!found) return page;
    const lines = found.markdown
      .split(/\r?\n/u)
      .map((line) => line.replace(/^#+\s*/u, "").replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim())
      .filter((line) => line !== "" && !/^[|:\-\s]+$/u.test(line));
    return { page: page.page, lines, source: "ocr" as const };
  });
}

// --- What the model reads --------------------------------------------------------------

export interface AmountRef {
  ref: string;
  cents: number;
  page: number;
}

export interface PoDocument {
  text: string;
  refs: Map<string, AmountRef>;
  pageCount: number;
  // Letters and digits only, upper case, per page: to check that a number is printed.
  compact: Map<number, string>;
  // Every number token per page with its leading zeros dropped ("0051" -> "51"), for Lots.
  numbers: Map<number, Set<string>>;
}

// An amount: two to four decimals, with or without $, thousands separators and a sign or parentheses.
const AMOUNT = /\(?-?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2,4}\)?/gu;

export function compactKey(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

/** A Lot as compared: upper case, no spaces, no leading zeros before the first digit ("007" -> "7"). */
export function lotKey(value: string) {
  const key = compactKey(value);
  const stripped = key.replace(/^0+(?=\d)/u, "");
  return stripped;
}

export function amountCents(text: string): number | null {
  const negative = /\(|-/u.test(text);
  const digits = text.replace(/[()$,\s-]/gu, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

/** The text the model reads, with a reference after every printed amount. */
export function buildPoDocument(pages: PoPage[]): PoDocument {
  const refs = new Map<string, AmountRef>();
  const compact = new Map<number, string>();
  const numbers = new Map<number, Set<string>>();
  const out: string[] = [];

  for (const page of pages) {
    out.push(`=== Page ${page.page}${page.source === "ocr" ? " (scanned, read with OCR)" : ""} ===`);
    const pageNumbers = new Set<string>();
    for (const line of page.lines) {
      for (const token of line.match(/[A-Za-z]*\d[\dA-Za-z]*/gu) ?? []) pageNumbers.add(lotKey(token));
      out.push(line.replace(AMOUNT, (match) => {
        const cents = amountCents(match);
        if (cents === null) return match;
        const ref = `#${refs.size + 1}`;
        refs.set(ref, { ref, cents, page: page.page });
        return `${match} [${ref}]`;
      }));
    }
    compact.set(page.page, compactKey(page.lines.join(" ")));
    numbers.set(page.page, pageNumbers);
  }

  const text = out.join("\n");
  if (text.length > MAX_DOCUMENT_CHARS) {
    throw new ChangeOrderPoReadError("This PDF is too long to be read. Split it into smaller PDFs.");
  }
  return { text, refs, pageCount: pages.length, compact, numbers };
}

// --- The request -------------------------------------------------------------------------

const INSTRUCTIONS = `You read documents a home builder sent to ValTrim Inc., a finish carpentry subcontractor, for extra work:
purchase orders, change orders, customer service work orders, field purchase orders, contract change authorizations.
One PDF can hold several separate orders. Pages of terms and conditions, lien releases or signature pages that
belong to an order are part of that order, not a new order.

Every amount printed in the document is followed by a reference like [#12]. You NEVER write an amount: you
answer with the reference of the printed amount. Copy every other value exactly as printed.

Answer with JSON only, in this shape:
{"orders":[{
  "number": "the identifier the builder pays this order by: the Purchase Order #, Change Order #, Work order #, Contract No.",
  "number_label": "the label printed next to it, e.g. Purchase Order #",
  "kind": "PURCHASE_ORDER | CHANGE_ORDER | WORK_ORDER | FIELD_PO | CONTRACT | OTHER",
  "pages": [1, 2],
  "date": "YYYY-MM-DD issue or order date, or null",
  "builder": "the builder or company that issued it, as printed",
  "project": "project, community or subdivision, as printed",
  "description": "the scope of work, short, as printed",
  "total_ref": "#n of the total of this order, or null",
  "net_total_ref": "#n of the amount after an OCIP or other deduction when one is printed, else null",
  "other_numbers": [{"label": "FPO Request", "value": "2079438"}],
  "lines": [{
    "lots": ["12", "13"],
    "lots_text": "the exact printed text the Lots were read from, e.g. Lots 12 - 17",
    "phase": "as printed or null",
    "building": "as printed or null",
    "plan": "as printed or null",
    "description": "as printed or null",
    "amount_ref": "#n of the amount of this line, or null"
  }]
}]}

Rules:
- One entry in "orders" per distinct order. Two orders never share a number unless the document prints them as separate orders.
- On a Field Purchase Order the number is the "Purchase Order #", not the "FPO Request" (put that in other_numbers).
- "lines": one line per Lot (or per group of Lots that share one printed amount) with the amount printed for it.
  When the order prints no amount per Lot, give one line with all its Lots and the order total as amount_ref.
  When no Lot is printed (a sales office, a design center), give one line with "lots": [].
- Lots are written without words: "Lot: 012" -> "012"; "Lots 12 - 17" -> "12","13","14","15","16","17".
- Ignore amounts of earlier change orders, original contract sums, unit costs and quantities: only this order's line amounts and total.
- Use null when something is not printed. Do not guess.`;

export function buildPoRequest(document: PoDocument, model: string) {
  return {
    model,
    temperature: 0,
    max_tokens: MAX_ANSWER_TOKENS,
    stream: true,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INSTRUCTIONS },
      { role: "user", content: `The document:\n\n${document.text}` },
    ],
  };
}

// --- The answer ------------------------------------------------------------------------------

export interface ReadPoLine {
  lots: string[];
  lotsText: string | null;
  lotsChecked: boolean;
  phase: string | null;
  building: string | null;
  plan: string | null;
  description: string | null;
  amountCents: number | null;
}

export interface ReadPo {
  position: number;
  number: string | null;
  numberLabel: string | null;
  kind: OrderKind;
  pages: number[];
  date: string | null;
  builder: string | null;
  project: string | null;
  description: string | null;
  totalCents: number | null;
  netTotalCents: number | null;
  otherNumbers: Array<{ label: string; value: string }>;
  lines: ReadPoLine[];
  warnings: string[];
}

const text = (value: unknown, max: number) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).replace(/\s+/gu, " ").trim().slice(0, max);
  return result === "" || result.toLowerCase() === "null" ? null : result;
};

const list = (value: unknown) => (Array.isArray(value) ? value : []);

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The JSON the model answered. */
export function parsePoAnswer(content: string): unknown[] {
  let payload: unknown;
  try {
    payload = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/gu, ""));
  } catch {
    throw new ChangeOrderPoReadError("The AI answer could not be read. Try again.");
  }
  const orders = (payload as { orders?: unknown })?.orders;
  if (!Array.isArray(orders)) throw new ChangeOrderPoReadError("The AI answer had no orders. Try again.");
  return orders.slice(0, MAX_ORDERS);
}

/** Every Lot a printed text names, ranges included: "Lots 12 - 17, 20" -> 12..17, 20. */
export function lotsInText(value: string): Set<string> {
  const found = new Set<string>();
  const ranges = /(\d+)\s*(?:-|–|—|to|thru|through)\s*(\d+)/giu;
  for (const match of value.matchAll(ranges)) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (to >= from && to - from <= MAX_RANGE) {
      for (let lot = from; lot <= to; lot += 1) found.add(String(lot));
    }
  }
  for (const token of value.match(/[A-Za-z]*\d[\dA-Za-z]*/gu) ?? []) found.add(lotKey(token));
  return found;
}

/**
 * The orders as they can be trusted: every amount comes from the PDF, a number that is not printed is
 * dropped, and every Lot that cannot be found printed is flagged.
 */
export function verifyPoAnswer(orders: unknown[], document: PoDocument): ReadPo[] {
  return foldSupportPages(verifyOrders(orders, document));
}

/**
 * A page with no order number of its own (the Change Order Request behind a Purchase Order, a cost
 * breakdown) is support of a numbered order, not an order: it joins that order's pages. It joins the
 * numbered order with the same total, or, when it shows no amount, the only numbered order of the PDF.
 * One that matches no order, or several, stays apart with its warning.
 */
export function foldSupportPages(orders: ReadPo[]): ReadPo[] {
  const numbered = orders.filter((order) => order.number !== null);
  if (numbered.length === 0) return orders;
  const folded = new Set<ReadPo>();
  const extraPages = new Map<ReadPo, number[]>();
  for (const order of orders) {
    if (order.number !== null) continue;
    const hasAmount = order.totalCents !== null || order.lines.some((line) => line.amountCents !== null);
    const targets = order.totalCents !== null
      ? numbered.filter((candidate) => candidate.totalCents === order.totalCents)
      : hasAmount
      ? []
      : numbered.length === 1
      ? numbered
      : [];
    if (targets.length !== 1) continue;
    folded.add(order);
    extraPages.set(targets[0], [...(extraPages.get(targets[0]) ?? []), ...order.pages]);
  }
  if (folded.size === 0) return orders;
  return orders
    .filter((order) => !folded.has(order))
    .map((order, index) => ({
      ...order,
      position: index + 1,
      pages: [...new Set([...order.pages, ...(extraPages.get(order) ?? [])])].sort((left, right) => left - right),
    }));
}

function verifyOrders(orders: unknown[], document: PoDocument): ReadPo[] {
  const allPages = Array.from({ length: document.pageCount }, (_, index) => index + 1);
  return orders.map((raw, index) => {
    const order = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const warnings: string[] = [];
    let pages = [...new Set(list(order.pages).map(Number))]
      .filter((page) => Number.isInteger(page) && page >= 1 && page <= document.pageCount)
      .sort((left, right) => left - right);
    if (pages.length === 0) pages = allPages;
    const printed = pages.map((page) => document.compact.get(page) ?? "").join(" ");
    const isPrinted = (value: string) => compactKey(value) !== "" && printed.includes(compactKey(value));
    const pageNumbers = new Set(pages.flatMap((page) => [...(document.numbers.get(page) ?? [])]));

    const amount = (ref: unknown, what: string) => {
      const key = text(ref, 12);
      if (key === null) return null;
      const found = document.refs.get(key.startsWith("#") ? key : `#${key}`);
      if (!found) {
        warnings.push(`The ${what} the AI gave is not an amount printed in the PDF; it was left out.`);
        return null;
      }
      return found.cents;
    };

    let number = text(order.number, 80);
    if (number !== null && !isPrinted(number)) {
      warnings.push(`The order number "${number}" is not printed on its pages; it was left out.`);
      number = null;
    }
    if (number === null) warnings.push("No order number was found.");

    const otherNumbers = list(order.other_numbers)
      .map((item) => {
        const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return { label: text(entry.label, 60) ?? "Number", value: text(entry.value, 80) ?? "" };
      })
      .filter((entry) => entry.value !== "" && isPrinted(entry.value))
      .slice(0, 10);

    const kindText = text(order.kind, 20)?.toUpperCase() ?? "";
    const kind = (ORDER_KINDS as readonly string[]).includes(kindText) ? kindText as OrderKind : "OTHER";
    const dateText = text(order.date, 10);
    const date = dateText && /^\d{4}-\d{2}-\d{2}$/u.test(dateText) && !Number.isNaN(Date.parse(dateText))
      ? dateText
      : null;

    const lines: ReadPoLine[] = list(order.lines).slice(0, MAX_LINES).map((item) => {
      const line = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const lots = [...new Set(list(line.lots).map((lot) => text(lot, 40)).filter((lot): lot is string => lot !== null))];
      const lotsText = text(line.lots_text, 300);
      const named = lotsText !== null && isPrinted(lotsText) ? lotsInText(lotsText) : new Set<string>();
      const unchecked = lots.filter((lot) => !named.has(lotKey(lot)) && !pageNumbers.has(lotKey(lot)));
      if (unchecked.length > 0) {
        warnings.push(`Lot${unchecked.length === 1 ? "" : "s"} ${unchecked.join(", ")} could not be found printed in the PDF.`);
      }
      return {
        lots,
        lotsText,
        lotsChecked: unchecked.length === 0,
        phase: text(line.phase, 40),
        building: text(line.building, 80),
        plan: text(line.plan, 80),
        description: text(line.description, 1000),
        amountCents: amount(line.amount_ref, "line amount"),
      };
    });

    const totalCents = amount(order.total_ref, "total");
    const netTotalCents = amount(order.net_total_ref, "net total");
    const lineAmounts = lines.map((line) => line.amountCents).filter((cents): cents is number => cents !== null);
    if (totalCents !== null && lineAmounts.length > 1) {
      const sum = lineAmounts.reduce((total, cents) => total + cents, 0);
      if (sum !== totalCents) {
        warnings.push(`The lines add up to ${money(sum)} but the total printed is ${money(totalCents)}.`);
      }
    }
    if (totalCents === null && lineAmounts.length === 0) warnings.push("No amount was found.");

    return {
      position: index + 1,
      number,
      numberLabel: text(order.number_label, 60),
      kind,
      pages,
      date,
      builder: text(order.builder, 200),
      project: text(order.project, 200),
      description: text(order.description, 2000),
      totalCents,
      netTotalCents,
      otherNumbers,
      lines,
      warnings,
    };
  });
}

// --- The calls ---------------------------------------------------------------------------------

async function callMistral(url: string, apiKey: string, body: unknown, fetcher: typeof fetch, what: string) {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch {
    throw new ChangeOrderPoReadError(`The ${what} did not answer in time. Try again in a moment.`);
  }
  if (!response.ok) {
    if (response.status === 429) throw new ChangeOrderPoReadError(`The ${what} is busy. Try again in a minute.`);
    const detail = providerErrorDetail(await response.json().catch(() => null));
    throw new ChangeOrderPoReadError(
      `The ${what} could not read this PDF (error ${response.status}${detail ? `: ${detail}` : ""}).`,
    );
  }
  return await response.json().catch(() => null);
}

/** The text of every page of a scanned PDF, read with Mistral OCR. */
export async function readWithOcr(
  bytes: Uint8Array,
  options: { apiKey: string; fetcher?: typeof fetch },
): Promise<Array<{ index: number; markdown: string }>> {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  const payload = await callMistral(OCR_ENDPOINT, options.apiKey, {
    model: OCR_MODEL,
    document: { type: "document_url", document_url: `data:application/pdf;base64,${btoa(binary)}` },
  }, options.fetcher ?? fetch, "OCR") as { pages?: Array<{ index?: unknown; markdown?: unknown }> } | null;
  return (payload?.pages ?? [])
    .filter((page) => typeof page.index === "number" && typeof page.markdown === "string")
    .map((page) => ({ index: page.index as number, markdown: page.markdown as string }));
}

/** A try that is worth repeating with another model: it stalled, ran out of time or wrote blanks. */
class AiStalledError extends ChangeOrderPoReadError {}

const STALLED_MESSAGE = "The AI did not answer in time. Try again in a moment.";

/**
 * Asks the model with the answer streamed in, so a model that stops sending (AI_IDLE_MS) or writes
 * blanks without end is cut as soon as it happens instead of at the end of the whole wait.
 */
async function streamAnswer(
  body: unknown,
  options: { apiKey: string; fetcher: typeof fetch; timeoutMs: number; idleMs: number },
): Promise<string> {
  const controller = new AbortController();
  const total = setTimeout(() => controller.abort(), options.timeoutMs);
  let idle = setTimeout(() => controller.abort(), options.idleMs);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), options.idleMs);
  };
  try {
    let response: Response;
    try {
      response = await options.fetcher(AI_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new AiStalledError(STALLED_MESSAGE);
    }
    if (!response.ok) {
      if (response.status === 429) throw new ChangeOrderPoReadError("The AI is busy. Try again in a minute.");
      const detail = providerErrorDetail(await response.json().catch(() => null));
      throw new ChangeOrderPoReadError(
        `The AI could not read this PDF (error ${response.status}${detail ? `: ${detail}` : ""}).`,
      );
    }

    // A plain JSON answer (no stream) is read whole.
    if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const payload = await response.json().catch(() => null) as
        | { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> }
        | null;
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new ChangeOrderPoReadError("The AI answer was cut off. Split the PDF into smaller PDFs.");
      }
      const content = answerText(choice?.message?.content);
      if (content === null) throw new ChangeOrderPoReadError("The AI gave no answer. Try again.");
      return content;
    }

    if (!response.body) throw new ChangeOrderPoReadError("The AI gave no answer. Try again.");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let content = "";
    let blankRun = 0;
    let finish: string | null = null;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        touch();
        buffer += value;
        const events = buffer.split("\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const data = event.trim();
          if (!data.startsWith("data:")) continue;
          const raw = data.slice(5).trim();
          if (raw === "[DONE]") continue;
          const chunk = JSON.parse(raw) as {
            choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }>;
          };
          const choice = chunk.choices?.[0];
          // Blank pieces count here (answerText drops them), since a run of them is what is watched.
          const delta = choice?.delta?.content;
          const piece = typeof delta === "string" ? delta : answerText(delta) ?? "";
          content += piece;
          blankRun = piece.trim() === "" ? blankRun + piece.length : piece.length - piece.trimEnd().length;
          if (blankRun > MAX_BLANK_RUN) throw new AiStalledError(STALLED_MESSAGE);
          if (choice?.finish_reason) finish = choice.finish_reason;
        }
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof ChangeOrderPoReadError) throw error;
      throw new AiStalledError(STALLED_MESSAGE);
    }
    if (finish === "length") {
      throw new ChangeOrderPoReadError("The AI answer was cut off. Split the PDF into smaller PDFs.");
    }
    if (content.trim() === "") throw new ChangeOrderPoReadError("The AI gave no answer. Try again.");
    return content;
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
}

/**
 * The orders of the document, read by the model and checked against the PDF. When the model stalls,
 * the faster fallback model is asked once, if the time left (until `deadline`) is enough.
 */
export async function readOrdersWithAi(
  document: PoDocument,
  options: {
    apiKey: string;
    model?: string;
    fetcher?: typeof fetch;
    deadline?: number;
    idleMs?: number;
    now?: () => number;
  },
): Promise<{ model: string; orders: ReadPo[] }> {
  const now = options.now ?? Date.now;
  const first = options.model?.trim() || AI_DEFAULT_MODEL;
  const models = first === AI_FALLBACK_MODEL ? [first] : [first, AI_FALLBACK_MODEL];
  let lastError: unknown = null;
  for (const [attempt, model] of models.entries()) {
    const left = options.deadline === undefined ? AI_TIMEOUT_MS : options.deadline - now();
    if (attempt > 0 && left < MIN_RETRY_MS) break;
    try {
      const content = await streamAnswer(buildPoRequest(document, model), {
        apiKey: options.apiKey,
        fetcher: options.fetcher ?? fetch,
        timeoutMs: Math.max(1_000, Math.min(AI_TIMEOUT_MS, left)),
        idleMs: options.idleMs ?? AI_IDLE_MS,
      });
      return { model, orders: verifyPoAnswer(parsePoAnswer(content), document) };
    } catch (error) {
      if (!(error instanceof AiStalledError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
