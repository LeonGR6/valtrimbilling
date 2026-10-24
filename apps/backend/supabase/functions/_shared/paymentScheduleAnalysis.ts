import { parseLineItemSchedule } from "./paymentScheduleLineItems.ts";
import { parseMatrixSchedule } from "./paymentScheduleMatrix.ts";
import { PaymentScheduleError } from "./paymentScheduleTypes.ts";
import type { ParsedSchedule } from "./paymentScheduleTypes.ts";
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
}

/** Pure part of the analysis, split from the PDF read so tests can feed pages. */
export function analyzePaymentScheduleContent(
  content: ReleasePdfContent,
): PaymentScheduleAnalysis {
  if (content.textLength < MIN_TEXT_LENGTH) {
    throw new PaymentScheduleError(
      "no_text",
      "This PDF has no readable text. Scanned Payment Schedules are not supported yet.",
    );
  }

  // The matrix header (Lot + several "Nth Draw") is specific, so it is tried
  // first; a line item table never has one.
  const parsed = parseMatrixSchedule(content.pages) ??
    parseLineItemSchedule(content.pages);
  if (!parsed) {
    throw new PaymentScheduleError(
      "unrecognized_layout",
      "The Lots and draws of this Payment Schedule could not be found.",
    );
  }

  return {
    ...parsed,
    detectionMethod: "text_layer",
    pageCount: content.pageCount,
    pageSizes: content.pageSizes,
  };
}

export async function analyzePaymentSchedulePdf(bytes: Uint8Array) {
  const content = await readReleasePdf(bytes, {
    maxContentPages: MAX_ANALYZED_PAGES,
  });
  return analyzePaymentScheduleContent(content);
}
