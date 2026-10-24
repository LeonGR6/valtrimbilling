import {
  classifyReleaseType,
  type ReleaseClassification,
} from "./releaseClassifier.ts";
import {
  buildLines,
  detectLabelsInLines,
  detectReleaseFields,
  type FieldSuggestion,
} from "./releaseFields.ts";
import type { TiebreakAnswer, TiebreakInput } from "./releaseLlm.ts";
import { OcrError, type OcrPage } from "./releaseOcr.ts";
import { ocrPagesToContent } from "./releaseOcrLayout.ts";
import { type PageSize, readReleasePdf } from "./releasePdf.ts";
import { displayPageSize } from "./releaseGeometry.ts";
import { RELEASE_TYPES } from "./releaseTypes.ts";

// Pure orchestration of one Release analysis: read the PDF, classify its type
// and suggest where the variables go. OCR and the LLM tie-breaker are injected
// so this runs (and is tested) without any network. Nothing returned contains
// document text beyond the short public form title used as evidence.

// Below this many characters on page 1 the PDF is treated as a scan.
export const MIN_FIRST_PAGE_TEXT_CHARS = 80;
// A model answer never counts as certain: the reviewer still confirms it.
export const LLM_CONFIDENCE_CAP = 0.7;
// Box positions estimated from OCR paragraphs are never as sure as a text layer.
export const OCR_POSITION_CONFIDENCE_CAP = 0.7;

export type DetectionMethod = "acroform" | "text_layer" | "ocr";

export interface AnalysisDeps {
  ocr?: (bytes: Uint8Array, pageCount: number) => Promise<OcrPage[]>;
  tiebreak?: (input: TiebreakInput) => Promise<TiebreakAnswer | null>;
}

export interface ReleaseAnalysis {
  classification: ReleaseClassification;
  detectionMethod: DetectionMethod;
  pageCount: number;
  pageSizes: PageSize[];
  suggestions: FieldSuggestion[];
}

function roundPoints(value: number) {
  return Math.round(value * 100) / 100;
}

export async function analyzeReleasePdf(
  bytes: Uint8Array,
  fileName: string,
  deps: AnalysisDeps = {},
): Promise<ReleaseAnalysis> {
  const content = await readReleasePdf(bytes);
  const [firstPage] = content.pages;
  const firstPageChars = firstPage.runs.reduce(
    (total, run) => total + run.text.trim().length,
    0,
  );

  let firstPageLines: string[];
  let ocrPages: OcrPage[] | null = null;
  if (firstPageChars >= MIN_FIRST_PAGE_TEXT_CHARS) {
    firstPageLines = buildLines(firstPage.runs).map(({ text }) => text);
  } else {
    if (!deps.ocr) throw new OcrError("not_configured");
    ocrPages = await deps.ocr(bytes, content.pageCount);
    firstPageLines = ocrPages[0]?.lines ?? [];
  }

  let classification = classifyReleaseType({ firstPageLines, fileName });
  if (classification.needsTiebreak && deps.tiebreak) {
    const candidates = classification.candidates.length > 0
      ? classification.candidates.map(({ releaseType }) => releaseType)
      : [...RELEASE_TYPES];
    const answer = await deps.tiebreak({ lines: firstPageLines, candidates });
    if (answer && candidates.includes(answer.releaseType)) {
      classification = {
        ...classification,
        releaseType: answer.releaseType,
        confidence: Math.min(answer.confidence, LLM_CONFIDENCE_CAP),
        method: "llm",
        needsTiebreak: true,
      };
    }
  }

  const hasWidgets = content.pages.some((page) => page.widgets.length > 0);
  return {
    classification,
    detectionMethod: ocrPages ? "ocr" : hasWidgets ? "acroform" : "text_layer",
    pageCount: content.pageCount,
    pageSizes: content.pageSizes.map((size) => ({
      page: size.page,
      width: roundPoints(size.width),
      height: roundPoints(size.height),
      rotation: size.rotation,
    })),
    suggestions: ocrPages
      ? suggestionsFromOcr(ocrPages, content.pageSizes)
      : detectReleaseFields(content.pages).suggestions,
  };
}

// Pages with usable OCR boxes go through the same detector as a text layer and
// get a box to confirm; pages without them keep the label only (the reviewer
// then places the box by hand).
function suggestionsFromOcr(ocrPages: OcrPage[], pageSizes: PageSize[]) {
  const contents = ocrPagesToContent(ocrPages, pageSizes.map(displayPageSize));

  const positioned = contents.flatMap((content) =>
    content
      ? detectReleaseFields([content]).suggestions.map((suggestion) => ({
        ...suggestion,
        source: "ocr" as const,
        confidence: Math.min(suggestion.confidence, OCR_POSITION_CONFIDENCE_CAP),
        reason: `${suggestion.reason} (position estimated from OCR)`,
      }))
      : []
  );
  const labelsOnly = detectLabelsInLines(
    ocrPages.map((page, index) => contents[index] ? [] : page.lines),
  );

  return [...positioned, ...labelsOnly].sort((left, right) =>
    right.confidence - left.confidence
  );
}
