import { getDocumentProxy } from "npm:unpdf@^1.8.1";
import { normalizeRotation } from "./releaseGeometry.ts";
import type { PageContent, TextRun, Widget } from "./releaseTypes.ts";

// Reads a PDF with pdf.js (through unpdf) into the plain structures the pure
// classifier and field detector work on. pdf.js is the only parser used for
// analysis: it recovers widgets and text from files whose AcroForm tree is
// damaged, where pdf-lib's form API throws.

export const MAX_ANALYZED_PAGES = 100;
// Page sizes are read for every page; text and fields for the first few. A
// Release is a one or two page form.
export const MAX_CONTENT_PAGES = 5;

export interface PageSize {
  page: number;
  width: number;
  height: number;
  rotation: number;
}

export interface ReleasePdfContent {
  pageCount: number;
  pageSizes: PageSize[];
  // Pages with text runs and widgets (the first MAX_CONTENT_PAGES).
  pages: PageContent[];
  // Characters of text found on the content pages. Near zero means a scan.
  textLength: number;
}

export class ReleasePdfError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReleasePdfError";
  }
}

function toWidget(annotation: Record<string, unknown>, origin: [number, number]) {
  const rect = annotation.rect;
  if (!Array.isArray(rect) || rect.length !== 4) return null;
  const [x1, y1, x2, y2] = rect.map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

  const rawValue = annotation.fieldValue;
  const value = Array.isArray(rawValue)
    ? rawValue.join("")
    : typeof rawValue === "string"
    ? rawValue
    : "";
  return {
    name: String(annotation.fieldName ?? ""),
    rect: [x1 - origin[0], y1 - origin[1], x2 - origin[0], y2 - origin[1]],
    value,
  } satisfies Widget;
}

export interface ReadPdfOptions {
  // How many pages get their text and fields read. A Release is one or two
  // pages; a Payment Schedule table can run over many.
  maxContentPages?: number;
}

export async function readReleasePdf(
  bytes: Uint8Array,
  options: ReadPdfOptions = {},
): Promise<ReleasePdfContent> {
  const maxContentPages = options.maxContentPages ?? MAX_CONTENT_PAGES;
  let pdf;
  try {
    // pdf.js may detach the buffer it receives, so it gets a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    throw new ReleasePdfError("The PDF could not be opened.", { cause: error });
  }

  try {
    if (pdf.numPages < 1 || pdf.numPages > MAX_ANALYZED_PAGES) {
      throw new ReleasePdfError(
        `Use a PDF with 1 to ${MAX_ANALYZED_PAGES} pages.`,
      );
    }

    const pageSizes: PageSize[] = [];
    const pages: PageContent[] = [];
    let textLength = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const [left, bottom, right, top] = page.view;
      const size: PageSize = {
        page: pageNumber,
        width: right - left,
        height: top - bottom,
        rotation: normalizeRotation(page.rotate ?? 0),
      };
      pageSizes.push(size);
      if (pageNumber > maxContentPages) continue;

      const content = await page.getTextContent();
      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        runs.push({
          text: item.str,
          x: item.transform[4] - left,
          y: item.transform[5] - bottom,
          width: item.width,
          height: item.height || Math.abs(item.transform[3]),
        });
        textLength += item.str.trim().length;
      }

      const widgets: Widget[] = [];
      for (const annotation of await page.getAnnotations()) {
        if (annotation.subtype !== "Widget" || annotation.fieldType !== "Tx") {
          continue;
        }
        const widget = toWidget(annotation, [left, bottom]);
        if (widget) widgets.push(widget);
      }

      pages.push({ ...size, runs, widgets });
    }

    return { pageCount: pdf.numPages, pageSizes, pages, textLength };
  } catch (error) {
    if (error instanceof ReleasePdfError) throw error;
    throw new ReleasePdfError("The PDF could not be read.", { cause: error });
  } finally {
    await pdf.loadingTask.destroy();
  }
}
