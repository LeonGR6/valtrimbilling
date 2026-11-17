import { boxOnPage } from '../../release-templates/services/releasePdfGeometry.js'

// Highlights the amounts a Package bills on the builder's Payment Schedule PDF.
//
// Each cell is painted as a yellow box over its amount, blended by multiplying,
// so the printed amount stays fully readable under it, like a highlighter. The
// page is drawn on in its own coordinates, so rotated and cropped pages land
// where the review showed them. When a Package touches more than one schedule
// the highlighted PDFs are put one after the other in a single file.
//
// The "Previously Invoiced" and "This Request" rows are filled with plain text in
// the boxes the review confirmed, to the right of the "$" the form prints. A
// schedule often arrives with the amounts of the last invoice typed in as text
// annotations; those that sit in the boxes are replaced, not left under the new
// values.

// A highlighter yellow.
const HIGHLIGHT = { red: 1, green: 0.92, blue: 0.2 }

const MAX_FILL_SIZE = 9
const MIN_FILL_SIZE = 5
const FILL_LEFT_PADDING = 1.5
// A little more on the right, so a wide amount never touches the next "$".
const FILL_RIGHT_PADDING = 3
// Height of a digit relative to the font size (Helvetica).
const DIGIT_HEIGHT_EM = 0.72

async function loadLibrary() {
  // Loaded on demand: the library is only needed when a PDF is generated.
  return import('@cantoo/pdf-lib')
}

function pageGeometry(page) {
  const crop = page.getCropBox()
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    rotation: page.getRotation().angle,
  }
}

// Writes a value in its box: as large as the box is tall, shrunk to fit its width,
// and centered on the line.
function fillBox(page, font, fill, library) {
  const { degrees, rgb } = library
  const box = boxOnPage(pageGeometry(page), fill.rect)

  const inside = Math.max(1, box.width - FILL_LEFT_PADDING - FILL_RIGHT_PADDING)
  let size = Math.min(MAX_FILL_SIZE, Math.max(MIN_FILL_SIZE, box.height - 2))
  const needed = font.widthOfTextAtSize(fill.text, size)
  if (needed > inside) size = Math.max(MIN_FILL_SIZE, size * (inside / needed))

  const point = box.at(FILL_LEFT_PADDING, Math.max(0, (box.height - size * DIGIT_HEIGHT_EM) / 2))
  page.drawText(fill.text, {
    x: point.x,
    y: point.y,
    size,
    font,
    color: rgb(0, 0, 0),
    rotate: degrees(box.rotation),
  })
}

// The box on the page in PDF coordinates, as [left, bottom, right, top].
function pdfBounds(page, rect) {
  const box = boxOnPage(pageGeometry(page), rect)
  const corners = [box.at(0, 0), box.at(box.width, 0), box.at(0, box.height), box.at(box.width, box.height)]
  const xs = corners.map(({ x }) => x)
  const ys = corners.map(({ y }) => y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

// Removes the text annotations (FreeText) whose rectangle touches any of the
// boxes. Returns how many were removed.
function removeTypedValues(page, rects, library) {
  const { PDFArray, PDFDict, PDFName } = library
  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annotations) return 0

  const bounds = rects.map((rect) => pdfBounds(page, rect))
  let removed = 0
  for (let index = annotations.size() - 1; index >= 0; index -= 1) {
    const annotation = annotations.lookupMaybe(index, PDFDict)
    if (annotation?.get(PDFName.of('Subtype')) !== PDFName.of('FreeText')) continue

    const rectangle = annotation.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asRectangle()
    if (!rectangle) continue
    const left = rectangle.x
    const bottom = rectangle.y
    const right = rectangle.x + rectangle.width
    const top = rectangle.y + rectangle.height

    const touches = bounds.some(([bl, bb, br, bt]) => left < br && right > bl && bottom < bt && top > bb)
    if (touches) {
      annotations.remove(index)
      removed += 1
    }
  }
  return removed
}

/**
 * @param sources {Array<{
 *   pdfBytes: Uint8Array,
 *   cells: Array<{ page: number, rect: object }>,
 *   fills?: Array<{ page: number, rect: object, text: string }>,
 *   fillBoxes?: Array<{ page: number, rect: object }>
 * }>}
 *   One entry per schedule PDF: the cells to highlight, the values to write and
 *   every box of the two summary rows (to clear what is typed there).
 * @returns {{ bytes: Uint8Array, pageCount: number, highlighted: number, filled: number, replaced: number }}
 */
export async function buildPackageSchedulePdf(sources) {
  if (sources.length === 0) throw new Error('There is nothing to highlight.')

  const library = await loadLibrary()
  const { BlendMode, degrees, PDFDocument, rgb, StandardFonts } = library
  const color = rgb(HIGHLIGHT.red, HIGHLIGHT.green, HIGHLIGHT.blue)

  let highlighted = 0
  let filled = 0
  let replaced = 0
  const documents = []
  for (const { pdfBytes, cells, fills = [], fillBoxes = [] } of sources) {
    const document = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
    const pages = document.getPages()

    for (const cell of cells) {
      const page = pages[cell.page - 1]
      if (!page) continue

      const box = boxOnPage(pageGeometry(page), cell.rect)
      page.drawRectangle({
        x: box.origin.x,
        y: box.origin.y,
        width: box.width,
        height: box.height,
        rotate: degrees(box.rotation),
        color,
        blendMode: BlendMode.Multiply,
      })
      highlighted += 1
    }

    // Values typed into the rows by hand are the last invoice's, so they go.
    for (const [index, page] of pages.entries()) {
      const rects = fillBoxes.filter((box) => box.page === index + 1).map((box) => box.rect)
      if (rects.length > 0) replaced += removeTypedValues(page, rects, library)
    }

    if (fills.length > 0) {
      const font = await document.embedFont(StandardFonts.Helvetica)
      for (const fill of fills) {
        const page = pages[fill.page - 1]
        if (!page) continue
        fillBox(page, font, fill, library)
        filled += 1
      }
    }
    documents.push(document)
  }

  let output = documents[0]
  if (documents.length > 1) {
    output = await PDFDocument.create()
    for (const document of documents) {
      const copied = await output.copyPages(document, document.getPageIndices())
      for (const page of copied) output.addPage(page)
    }
  }

  return {
    // Plain objects keep the file readable by every viewer and by the tests.
    bytes: await output.save({ useObjectStreams: false }),
    pageCount: output.getPageCount(),
    highlighted,
    filled,
    replaced,
  }
}
