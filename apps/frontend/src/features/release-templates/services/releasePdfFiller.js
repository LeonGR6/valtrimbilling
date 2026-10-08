import { boxOnPage } from './releasePdfGeometry.js'
import { getReleaseVariable } from './releaseTemplateRecord.js'
import { formatReleaseValue } from './releaseValueFormat.js'

// Writes values into a Release PDF at the boxes of a confirmed mapping.
//
// Text is drawn at the box instead of being set on the AcroForm field: some
// templates have a damaged form tree where the form API fails, but the page
// and the box are always reliable. The form fields are removed first so an
// empty field can never sit on top of the printed value.

const PADDING = 2
const MIN_FONT_SHARE = 0.6
// Height of a capital letter relative to the font size (Helvetica).
const CAP_HEIGHT_EM = 0.72

async function loadLibrary() {
  // Loaded on demand: the library is only needed when a PDF is filled.
  return import('@cantoo/pdf-lib')
}

function stripWidgets(doc, { PDFName, PDFArray, PDFDict }) {
  const widget = PDFName.of('Widget')
  for (const page of doc.getPages()) {
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annotations) continue

    for (let index = annotations.size() - 1; index >= 0; index -= 1) {
      const annotation = annotations.lookupMaybe(index, PDFDict)
      if (annotation?.get(PDFName.of('Subtype')) === widget) annotations.remove(index)
    }
  }
  doc.catalog.delete(PDFName.of('AcroForm'))
}

// Keeps whatever is already printed in form fields (a partly filled template)
// by flattening; a damaged form is simply stripped.
function clearForm(doc, library) {
  try {
    doc.getForm().flatten()
  } catch {
    stripWidgets(doc, library)
  }
}

function fillFormField(doc, fieldName, text) {
  try {
    doc.getForm().getTextField(fieldName).setText(text)
    return true
  } catch {
    return false
  }
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

/** Shrinks the font, down to a limit, so the text fits the box width. */
function fittingFontSize(font, text, size, width) {
  const available = Math.max(1, width - PADDING * 2)
  const needed = font.widthOfTextAtSize(text, size)
  if (needed <= available) return size
  return Math.max(size * MIN_FONT_SHARE, size * (available / needed))
}

function drawInBox(page, font, text, field, library) {
  const { degrees, rgb } = library
  const rect = field.target
  const box = boxOnPage(pageGeometry(page), rect)

  if (field.cover) {
    page.drawRectangle({
      x: box.origin.x,
      y: box.origin.y,
      width: box.width,
      height: box.height,
      rotate: degrees(box.rotation),
      color: rgb(1, 1, 1),
    })
  }

  const size = fittingFontSize(font, text, field.fontSize, box.width)
  const baseline = Math.max(1, (box.height - size * CAP_HEIGHT_EM) / 2)
  const anchor = box.at(PADDING, baseline)
  page.drawText(text, {
    x: anchor.x,
    y: anchor.y,
    size,
    font,
    color: rgb(0, 0, 0),
    rotate: degrees(box.rotation),
  })
}

/**
 * @param pdfBytes {Uint8Array}
 * @param mapping a confirmed version 1 mapping
 * @param values raw values by variable key: dates as 'YYYY-MM-DD', amounts as
 *   numbers or numeric text. A missing or unusable value leaves its blank empty.
 * @returns {{ bytes: Uint8Array, filled: string[], skipped: string[] }}
 */
export async function fillReleasePdf({ pdfBytes, mapping, values }) {
  const library = await loadLibrary()
  const { PDFDocument, StandardFonts } = library
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })

  const texts = mapping.fields.map((field) => ({
    field,
    text: formatReleaseValue(field.variable, field.format, values[field.variable]),
  }))

  const filled = []
  const skipped = []

  // Fields that name a form field are filled through the form first, while it
  // still exists.
  for (const { field, text } of texts) {
    if (field.target.kind !== 'acroform') continue
    if (text && fillFormField(doc, field.target.fieldName, text)) filled.push(field.variable)
    else skipped.push(field.variable)
  }

  clearForm(doc, library)

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  for (const { field, text } of texts) {
    if (field.target.kind !== 'rect') continue

    const page = pages[field.target.page - 1]
    if (!text || !page || !getReleaseVariable(field.variable)) {
      skipped.push(field.variable)
      continue
    }

    drawInBox(page, font, text, { ...field, target: field.target }, library)
    filled.push(field.variable)
  }

  // The form is already flattened or removed. Letting pdf-lib refresh field
  // appearances on save would walk a damaged form tree and fail.
  return { bytes: await doc.save({ updateFieldAppearances: false }), filled, skipped }
}
