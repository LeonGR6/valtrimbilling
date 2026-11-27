import { parseLineItemSchedule } from "./paymentScheduleLineItems.ts";
import { parseMatrixSchedule } from "./paymentScheduleMatrix.ts";
import { parseNamedColumnSchedule } from "./paymentScheduleNamedColumns.ts";
import { PaymentScheduleError } from "./paymentScheduleTypes.ts";
import type { DrawName, ParsedSchedule } from "./paymentScheduleTypes.ts";
import { hasSummaryLabel } from "./paymentScheduleSummary.ts";
import { buildAiDocument } from "./paymentScheduleAi.ts";
import type { AiJobContext, AiReader } from "./paymentScheduleAi.ts";
import { verifyAiAnswer } from "./paymentScheduleAiVerify.ts";
import type { AiSummary } from "./paymentScheduleAiVerify.ts";
import { MAX_ANALYZED_PAGES, readReleasePdf } from "./releasePdf.ts";
import type { PageSize, ReleasePdfContent } from "./releasePdf.ts";

// Reads a Payment Schedule PDF and returns its cells. Only PDFs with a text
// layer are supported for now: the cell positions come straight from the text.

// Below this many characters a PDF is a scan.
const MIN_TEXT_LENGTH = 40;

export interface PaymentScheduleAnalysis extends ParsedSchedule {
  detectionMethod: "text_layer";
  pageCount: number;
  pageSizes: PageSize[];
  // Present when the AI found the cells: which model, what it noticed and how the
  // cells compare with the Job.
  ai?: AiSummary;
}

/** What the analysis may know besides the PDF. */
export interface PaymentScheduleHints {
  // The draws of the Billing Setup the Job bills with. A schedule whose columns carry
  // their names instead of "1st Draw" can only be numbered with them.
  drawNames?: DrawName[];
}

function unrecognizedMessage(drawNames: DrawName[]) {
  const base = "The Lots and draws of this Payment Schedule could not be found.";
  if (drawNames.length < 2) return base;

  const names = [...drawNames].sort((a, b) => a.draw - b.draw)
    .map(({ name }) => name).join(", ");
  return `${base} Its columns must be headed "1st Draw", "2nd Draw"... or carry the names of ` +
    `the draws in this Job's Billing Setup: ${names}.`;
}

/** Pure part of the analysis, split from the PDF read so tests can feed pages. */
export function analyzePaymentScheduleContent(
  content: ReleasePdfContent,
  hints: PaymentScheduleHints = {},
): PaymentScheduleAnalysis {
  if (content.textLength < MIN_TEXT_LENGTH) {
    throw new PaymentScheduleError(
      "no_text",
      "This PDF has no readable text. Scanned Payment Schedules are not supported yet.",
    );
  }

  const drawNames = hints.drawNames ?? [];
  // The matrix header (Lot + several "Nth Draw") is specific, so it is tried first; a
  // line item table never has one. Columns headed by name come last: they need the
  // Billing Setup, and nothing else is as loose about what a heading may say.
  const parsed = parseMatrixSchedule(content.pages) ??
    parseLineItemSchedule(content.pages) ??
    parseNamedColumnSchedule(content.pages, drawNames);
  if (!parsed) {
    throw new PaymentScheduleError("unrecognized_layout", unrecognizedMessage(drawNames));
  }

  return {
    ...parsed,
    detectionMethod: "text_layer",
    pageCount: content.pageCount,
    pageSizes: content.pageSizes,
  };
}

export async function readPaymentSchedulePdf(bytes: Uint8Array) {
  return await readReleasePdf(bytes, {
    maxContentPages: MAX_ANALYZED_PAGES,
    // The cells of the Previously Invoiced and This Request rows are found by the
    // borders of the table, so the pages that print those rows read their lines.
    readRulesWhen: hasSummaryLabel,
  });
}

export async function analyzePaymentSchedulePdf(
  bytes: Uint8Array,
  hints: PaymentScheduleHints = {},
) {
  return analyzePaymentScheduleContent(await readPaymentSchedulePdf(bytes), hints);
}

/**
 * Reads the schedule with AI, for a layout no parser knows: the model points at the
 * printed amounts and every answer is checked against the PDF and the Job.
 */
export async function analyzePaymentScheduleWithAi(
  content: ReleasePdfContent,
  context: AiJobContext,
  reader: AiReader,
): Promise<PaymentScheduleAnalysis> {
  if (content.textLength < MIN_TEXT_LENGTH) {
    throw new PaymentScheduleError(
      "no_text",
      "This PDF has no readable text. Scanned Payment Schedules are not supported yet.",
    );
  }

  const document = buildAiDocument(content.pages);
  const answer = await reader.read(document, context);
  return {
    ...verifyAiAnswer(answer, document, context, reader.model),
    detectionMethod: "text_layer",
    pageCount: content.pageCount,
    pageSizes: content.pageSizes,
  };
}
