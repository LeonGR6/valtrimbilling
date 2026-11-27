import { type OcrPage, cleanOcrMarkdown } from "./releaseOcr.ts";
import type { PageContent, TextRun } from "./releaseTypes.ts";

// Turns OCR paragraph boxes into the same page structure a PDF text layer gives
// (`PageContent`), so one detector finds the labels and places the boxes for
// scanned and digital PDFs alike.
//
// OCR boxes are per paragraph, not per word, so positions are ESTIMATED:
//  - a block with one line is exact (a lone label such as "Through Date:"),
//  - a block with several lines (a table of rows) is split into equal bands.
//    Such a block can span the whole table width, so a line's width is NOT
//    taken from the block: it is its length times the typical character width
//    measured on this page's single-line blocks (or a default).
// The detector reports these suggestions with a lower confidence and the
// reviewer confirms or moves them.

// Share of a line band that the text itself occupies.
const TEXT_HEIGHT_SHARE = 0.8;
// The baseline sits a little above the bottom of the band.
const BASELINE_SHARE = 0.2;
// Typical width of one character in points (about a 10 pt font) when the page
// has no single-line block to measure.
const DEFAULT_CHAR_WIDTH_POINTS = 5;

export interface DisplaySize {
  // Page size in points as it is displayed (after rotation).
  width: number;
  height: number;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Pixels one character takes on this page, from its single-line blocks. */
function charWidthPixels(page: OcrPage, scaleX: number) {
  const measured = page.blocks.flatMap((block) => {
    const lines = cleanOcrMarkdown(block.text);
    return lines.length === 1
      ? [(block.right - block.left) / lines[0].length]
      : [];
  });
  return measured.length > 0
    ? median(measured)
    : DEFAULT_CHAR_WIDTH_POINTS / scaleX;
}

function runsFor(
  page: OcrPage,
  scaleX: number,
  scaleY: number,
  pageHeight: number,
): TextRun[] {
  const runs: TextRun[] = [];
  const charWidth = charWidthPixels(page, scaleX);

  for (const block of page.blocks) {
    const lines = cleanOcrMarkdown(block.text);
    if (lines.length === 0) continue;

    const bandHeight = (block.bottom - block.top) / lines.length;

    lines.forEach((line, index) => {
      const bandBottom = block.top + (index + 1) * bandHeight;
      const baseline = bandBottom - bandHeight * BASELINE_SHARE;
      // A lone line is measured by its own box; lines of a larger block are
      // estimated, and never wider than the block itself.
      const width = lines.length === 1
        ? block.right - block.left
        : Math.min(line.length * charWidth, block.right - block.left);

      runs.push({
        text: line,
        x: block.left * scaleX,
        // PDF space has its origin at the bottom-left, the image at the top-left.
        y: pageHeight - baseline * scaleY,
        width: width * scaleX,
        height: bandHeight * TEXT_HEIGHT_SHARE * scaleY,
      });
    });
  }

  return runs;
}

/**
 * One entry per OCR page: its `PageContent`, or `null` when OCR returned no
 * usable boxes for that page (the caller then falls back to labels only).
 */
export function ocrPagesToContent(
  ocrPages: OcrPage[],
  displaySizes: DisplaySize[],
): Array<PageContent | null> {
  return ocrPages.map((page, index) => {
    const size = displaySizes[index];
    if (!size || !page.width || !page.height || page.blocks.length === 0) {
      return null;
    }

    const runs = runsFor(
      page,
      size.width / page.width,
      size.height / page.height,
      size.height,
    );
    if (runs.length === 0) return null;

    // The OCR image is the page as displayed, so the content is already in
    // displayed orientation: rotation 0 and the displayed size.
    return {
      page: index + 1,
      width: size.width,
      height: size.height,
      rotation: 0,
      runs,
      widgets: [],
    };
  });
}
