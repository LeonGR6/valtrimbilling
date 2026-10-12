import { boxOnPage } from '../../release-templates/services/releasePdfGeometry.js'

// Writes the text a person typed onto a Preliminary Notice PDF.
//
// An entry is one of:
//   free text  { kind: 'text', page, x, y, text, fontSize }
//   a blank    { kind: 'field', page, x, y, w, h, text, fontSize }
//   a check    { kind: 'check', page, x, y, w, h }
// Positions are fractions of the page AS DISPLAYED (after the page's /Rotate),
// from its top-left corner, exactly like the boxes of a Release template, so
// the same geometry puts them back on the page. Free text sits at its top-left
// corner; a blank or a check fills its rectangle.

export const MIN_FONT_SIZE = 6
export const MAX_FONT_SIZE = 36
export const DEFAULT_FONT_SIZE = 11
export const DEFAULT_FIELD_FONT_SIZE = 10
const MIN_FIELD_FONT_SIZE = 5
const FIELD_PADDING = 2
// Helvetica: the height of the text itself, and where its baseline falls in it.
const CONTENT_HEIGHT_EM = 1.117
const ASCENT_EM = 0.905
// The height of one line of text, in font sizes. The screen uses the same value.
export const LINE_HEIGHT_EM = 1.25
// Where the baseline sits above the bottom of the line (Helvetica).
const BASELINE_EM = 0.28
const MAX_TEXT_LENGTH = 300

async function loadLibrary() {
  // Loaded on demand: the library is only needed when a notice is edited.
  return import('@cantoo/pdf-lib')
}

function geometryOf(page) {
  const crop = page.getCropBox()
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    rotation: page.getRotation().angle,
  }
}

function displaySize(geometry) {
  const sideways = Math.abs(geometry.rotation % 180) === 90
  return sideways
    ? { width: geometry.height, height: geometry.width }
    : { width: geometry.width, height: geometry.height }
}

/** The page sizes, in points, of the PDF as the editor lays them out. */
export async function readNoticePages(pdfBytes) {
  const { PDFDocument } = await loadLibrary()
  let doc
  try {
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  } catch (error) {
    throw new Error('This PDF could not be read. Use a different file.', { cause: error })
  }

  return doc.getPages().map((page, index) => {
    const geometry = geometryOf(page)
    return {
      page: index + 1,
      width: geometry.width,
      height: geometry.height,
      rotation: ((Math.round(geometry.rotation / 90) % 4) + 4) % 4 * 90,
    }
  })
}

/** The standard PDF font prints Latin-1 text; anything else cannot be written. */
export function isPrintableNoticeText(text) {
  return /^[\x20-\x7E\xA0-\xFF]*$/.test(text)
}

export function clampFontSize(value) {
  const size = Number(value)
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size * 2) / 2))
}

/**
 * The entries for the detected blanks and check boxes of a form: a text for
 * every blank that has one, an X for every box that is checked.
 */
export function buildFieldEntries(fields, values) {
  return fields.flatMap((field) => {
    const value = values[field.id]
    const rectangle = { page: field.page, x: field.x, y: field.y, w: field.w, h: field.h }

    if (field.kind === 'check') {
      return value === true ? [{ kind: 'check', ...rectangle }] : []
    }
    if (typeof value !== 'string' || value.trim() === '') return []
    return [{ kind: 'field', ...rectangle, text: value, fontSize: DEFAULT_FIELD_FONT_SIZE }]
  })
}

/** The font size at which `text` fits a blank `maxWidth` points wide. */
export function fitFieldFontSize({ size, textWidth, maxWidth }) {
  if (textWidth <= maxWidth || textWidth <= 0) return size
  return Math.max(MIN_FIELD_FONT_SIZE, Math.floor(((size * maxWidth) / textWidth) * 10) / 10)
}

/** Distance from the top of a blank to the baseline of its text, in points. */
export function fieldBaselineFromTop(height, size) {
  return (height - size * CONTENT_HEIGHT_EM) / 2 + size * ASCENT_EM
}

/** The entries that will be written: checks, and the ones with text. */
export function writableEntries(entries) {
  return entries.filter((entry) => entry.kind === 'check' || entry.text.trim() !== '')
}

/** Why the entries cannot be saved, or null. */
export function describeEntriesProblem(entries) {
  for (const entry of writableEntries(entries)) {
    if (entry.kind === 'check') continue
    if (!isPrintableNoticeText(entry.text)) {
      return 'Use letters, numbers and common punctuation only: some text has characters a PDF cannot print.'
    }
    if (entry.text.length > MAX_TEXT_LENGTH) {
      return `Each text can have up to ${MAX_TEXT_LENGTH} characters.`
    }
  }
  return null
}

// An X across the square, drawn from corner to corner.
function drawCheck(page, box, rgb) {
  const inset = Math.min(1.4, box.width / 4)
  const corners = [
    [box.at(inset, inset), box.at(box.width - inset, box.height - inset)],
    [box.at(inset, box.height - inset), box.at(box.width - inset, inset)],
  ]
  for (const [start, end] of corners) {
    page.drawLine({ start, end, thickness: 1.2, color: rgb(0, 0, 0) })
  }
}

/**
 * @param pdfBytes {Uint8Array}
 * @param entries the typed texts; empty ones are skipped
 * @returns {Promise<Uint8Array>}
 */
export async function writeNoticeText({ pdfBytes, entries }) {
  const problem = describeEntriesProblem(entries)
  if (problem) throw new Error(problem)

  const { PDFDocument, StandardFonts, degrees, rgb } = await loadLibrary()
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()

  for (const entry of writableEntries(entries)) {
    const page = pages[entry.page - 1]
    if (!page) throw new Error(`The PDF has no page ${entry.page}.`)

    const geometry = geometryOf(page)
    const display = displaySize(geometry)

    if (entry.kind === 'check') {
      drawCheck(page, boxOnPage(geometry, entry), rgb)
      continue
    }

    if (entry.kind === 'field') {
      const box = boxOnPage(geometry, entry)
      const wanted = clampFontSize(entry.fontSize ?? DEFAULT_FIELD_FONT_SIZE)
      const size = fitFieldFontSize({
        size: wanted,
        textWidth: font.widthOfTextAtSize(entry.text, wanted),
        maxWidth: box.width - FIELD_PADDING * 2,
      })
      const anchor = box.at(FIELD_PADDING, box.height - fieldBaselineFromTop(box.height, size))
      page.drawText(entry.text, {
        x: anchor.x,
        y: anchor.y,
        size,
        font,
        color: rgb(0, 0, 0),
        rotate: degrees(box.rotation),
      })
      continue
    }

    const size = clampFontSize(entry.fontSize)
    const lineHeight = size * LINE_HEIGHT_EM
    const box = boxOnPage(geometry, {
      x: entry.x,
      y: entry.y,
      w: font.widthOfTextAtSize(entry.text, size) / display.width,
      h: lineHeight / display.height,
    })
    const anchor = box.at(0, size * BASELINE_EM)
    page.drawText(entry.text, {
      x: anchor.x,
      y: anchor.y,
      size,
      font,
      color: rgb(0, 0, 0),
      rotate: degrees(box.rotation),
    })
  }

  return doc.save({ updateFieldAppearances: false })
}

/** The name a notice that was filled in is saved under. */
export function filledNoticeFileName(name) {
  const base = String(name ?? '').trim().replace(/\.pdf$/i, '') || 'Preliminary Notice'
  return base.endsWith(' (filled)') ? `${base}.pdf` : `${base} (filled).pdf`
}
