import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { degrees, PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { fillReleasePdf } from '../src/features/release-templates/services/releasePdfFiller.js'

// Values are written into the PDF and then read back with pdf.js, the same
// engine the reviewer sees, so these tests check what a person would see: the
// text, where it sits on the DISPLAYED page, and that it is upright.

const PADDING = 2
const CAP_HEIGHT_EM = 0.72

async function readBack(bytes, pageNumber = 1) {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const annotations = await page.getAnnotations()

  const items = content.items
    .filter((item) => item.str.trim() !== '')
    .map((item) => {
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
      const [a, b] = pdfjs.Util.transform(viewport.transform, item.transform)
      return { text: item.str, x, y, width: item.width, upright: a > 0 && Math.abs(b) < 1e-6, size: Math.abs(item.transform[0]) || item.height }
    })
  await pdf.loadingTask.destroy()
  return { items, widgets: annotations.filter((a) => a.subtype === 'Widget').length, viewport }
}

// The fill color each text run of the first page is drawn with, by its text.
async function fillColors(bytes) {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise
  const { fnArray, argsArray } = await (await pdf.getPage(1)).getOperatorList()
  const colors = new Map()
  let color = '#000000'
  fnArray.forEach((fn, index) => {
    if (fn === pdfjs.OPS.setFillRGBColor) color = argsArray[index][0] ?? color
    if (fn === pdfjs.OPS.showText) {
      const text = argsArray[index][0].map((glyph) => glyph.unicode ?? '').join('')
      colors.set(text, color)
    }
  })
  await pdf.loadingTask.destroy()
  return colors
}

async function blankPdf({ rotation = 0, cropBox = null } = {}) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  if (rotation) page.setRotation(degrees(rotation))
  if (cropBox) page.setCropBox(...cropBox)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('FORM TITLE', { x: 72, y: 700, size: 12, font })
  return doc.save()
}

const mappingFor = (...fields) => ({ version: 1, fields })
const rectField = (variable, format, rect, extra = {}) => ({
  variable,
  target: { kind: 'rect', page: 1, ...rect },
  fontSize: 10,
  format,
  ...extra,
})

for (const rotation of [0, 90, 180, 270]) {
  test(`values land inside their boxes and upright on a page rotated ${rotation}`, async () => {
    const rect = { x: 0.25, y: 0.3, w: 0.3, h: 0.03 }
    const { bytes, filled, skipped } = await fillReleasePdf({
      pdfBytes: await blankPdf({ rotation }),
      mapping: mappingFor(
        rectField('through_date', 'MM/DD/YYYY', rect),
        rectField('check_amount', 'currency', { x: 0.25, y: 0.5, w: 0.3, h: 0.03 }),
      ),
      values: { through_date: '2026-09-30', check_amount: '1250' },
    })

    assert.deepEqual(filled, ['through_date', 'check_amount'])
    assert.deepEqual(skipped, [])

    const { items, viewport } = await readBack(bytes)
    const date = items.find((item) => item.text === '09/30/2026')
    const amount = items.find((item) => item.text === '$1,250.00')
    assert.ok(date && amount, 'both values are present')
    assert.ok(date.upright && amount.upright, 'the text reads left to right')

    // The text starts PADDING after the left edge of its box and its baseline
    // sits in the box, measured on the displayed page.
    const left = rect.x * viewport.width
    const top = rect.y * viewport.height
    const bottom = (rect.y + rect.h) * viewport.height
    const offset = Math.max(1, (bottom - top - 10 * CAP_HEIGHT_EM) / 2)
    assert.ok(Math.abs(date.x - (left + PADDING)) < 0.5, `x ${date.x} vs ${left + PADDING}`)
    assert.ok(Math.abs(date.y - (bottom - offset)) < 0.5, `y ${date.y} vs ${bottom - offset}`)
    assert.ok(date.y > top && date.y < bottom, 'baseline inside the box')
  })
}

test('a page with an offset crop box places the value inside the displayed box', async () => {
  const rect = { x: 0.1, y: 0.2, w: 0.4, h: 0.04 }
  const { bytes } = await fillReleasePdf({
    // setCropBox takes x, y, width and height.
    pdfBytes: await blankPdf({ cropBox: [50, 60, 350, 440] }),
    mapping: mappingFor(rectField('signature_date', 'YYYY-MM-DD', rect)),
    values: { signature_date: '2026-10-08' },
  })

  const { items, viewport } = await readBack(bytes)
  const date = items.find((item) => item.text === '2026-10-08')
  assert.equal(viewport.width, 350)
  assert.equal(viewport.height, 440)
  assert.ok(Math.abs(date.x - (rect.x * 350 + PADDING)) < 0.5)
  assert.ok(date.y > rect.y * 440 && date.y < (rect.y + rect.h) * 440)
})

test('text that does not fit is made smaller instead of overflowing the box', async () => {
  const { bytes } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor({
      ...rectField('through_date', 'MMMM D, YYYY', { x: 0.1, y: 0.2, w: 0.1, h: 0.03 }),
      fontSize: 12,
    }),
    values: { through_date: '2026-09-30' },
  })

  const { items } = await readBack(bytes)
  const date = items.find((item) => item.text === 'September 30, 2026')
  assert.ok(date.size < 12, `shrunk to ${date.size}`)
  assert.ok(date.size >= 12 * 0.6 - 0.01, 'never below 60% of the chosen size')
})

test('a blank with no usable value stays empty and is reported as skipped', async () => {
  const { bytes, filled, skipped } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor(
      rectField('through_date', 'MM/DD/YYYY', { x: 0.1, y: 0.2, w: 0.3, h: 0.03 }),
      rectField('check_amount', 'currency', { x: 0.1, y: 0.4, w: 0.3, h: 0.03 }),
      rectField('signature_date', 'MM/DD/YYYY', { x: 0.1, y: 0.6, w: 0.3, h: 0.03 }),
    ),
    values: { through_date: '2026-13-45', check_amount: 'abc' },
  })

  assert.deepEqual(filled, [])
  assert.deepEqual(skipped.sort(), ['check_amount', 'signature_date', 'through_date'])
  const { items } = await readBack(bytes)
  assert.deepEqual(items.map((item) => item.text), ['FORM TITLE'])
})

test('a box on a page the PDF does not have is skipped, not an error', async () => {
  const { skipped } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor({
      variable: 'through_date',
      target: { kind: 'rect', page: 4, x: 0.1, y: 0.2, w: 0.3, h: 0.03 },
      fontSize: 10,
      format: 'MM/DD/YYYY',
    }),
    values: { through_date: '2026-09-30' },
  })
  assert.deepEqual(skipped, ['through_date'])
})

test('the cover option still produces a valid PDF with the value on top', async () => {
  const { bytes } = await fillReleasePdf({
    pdfBytes: await blankPdf({ rotation: 90 }),
    mapping: mappingFor(rectField('check_amount', 'plain', { x: 0.2, y: 0.2, w: 0.3, h: 0.03 }, { cover: true })),
    values: { check_amount: 12.5 },
  })
  const { items } = await readBack(bytes)
  assert.ok(items.some((item) => item.text === '12.50'))
})

test('form fields are removed so an empty field cannot hide the value', async () => {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const field = doc.getForm().createTextField('through date')
  field.addToPage(page, { x: 100, y: 500, width: 190, height: 16 })
  const before = await readBack(await doc.save())
  assert.equal(before.widgets, 1)

  const { bytes } = await fillReleasePdf({
    pdfBytes: await doc.save(),
    mapping: mappingFor(rectField('through_date', 'MM/DD/YYYY', { x: 0.16, y: 0.2, w: 0.31, h: 0.02 })),
    values: { through_date: '2026-09-30' },
  })
  const after = await readBack(bytes)
  assert.equal(after.widgets, 0)
  assert.ok(after.items.some((item) => item.text === '09/30/2026'))
})

test('a form field target is filled through the form when the form works', async () => {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  doc.getForm().createTextField('date').addToPage(page, { x: 100, y: 500, width: 190, height: 16 })

  const { bytes, filled } = await fillReleasePdf({
    pdfBytes: await doc.save(),
    mapping: mappingFor({
      variable: 'signature_date',
      target: { kind: 'acroform', fieldName: 'date' },
      fontSize: 10,
      format: 'MM/DD/YYYY',
    }),
    values: { signature_date: '2026-09-30' },
  })
  assert.deepEqual(filled, ['signature_date'])
  const { items } = await readBack(bytes)
  assert.ok(items.some((item) => item.text.includes('09/30/2026')))
})

// --- Lists of values (the Exceptions lines) -----------------------------------

// The two Exceptions boxes of the Conditional Progress form, as the analysis
// reports them: dates 243-464 pt wide on a 612 pt page, amounts 304-464.
const datesBox = { x: 0.397, y: 0.7083, w: 0.3611, h: 0.0164 }
const amountsBox = { x: 0.4967, y: 0.7247, w: 0.2614, h: 0.0139 }

test('several values on one line are printed separated by commas', async () => {
  const { bytes, filled } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor(
      rectField('waiver_release_dates', 'MM/DD/YYYY', datesBox),
      rectField('unpaid_progress_amount', 'plain', amountsBox),
    ),
    values: {
      waiver_release_dates: ['2026-09-20', '2026-10-05'],
      unpaid_progress_amount: [1200, 845.5],
    },
  })

  assert.deepEqual(filled, ['waiver_release_dates', 'unpaid_progress_amount'])
  const texts = (await readBack(bytes)).items.map((item) => item.text)
  assert.ok(texts.includes('09/20/2026, 10/05/2026'))
  assert.ok(texts.includes('1,200.00, 845.50'))
})

test('an empty list leaves its blank empty and is reported as skipped', async () => {
  const { bytes, skipped } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor(rectField('waiver_release_dates', 'MM/DD/YYYY', datesBox)),
    values: { waiver_release_dates: [] },
  })
  assert.deepEqual(skipped, ['waiver_release_dates'])
  assert.deepEqual((await readBack(bytes)).items.map((item) => item.text), ['FORM TITLE'])
})

test('a long list shrinks, may use the margin to the right of its box, and stays on the page', async () => {
  const dates = Array.from({ length: 9 }, (_, index) => `2026-09-${String(10 + index).padStart(2, '0')}`)
  const { bytes } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor({ ...rectField('waiver_release_dates', 'MM/DD/YYYY', datesBox), fontSize: 10 }),
    values: { waiver_release_dates: dates },
  })

  const { items, viewport } = await readBack(bytes)
  const line = items.find((item) => item.text.startsWith('09/10/2026'))
  assert.ok(line, 'the whole list is on one line')
  assert.ok(line.size < 10, `shrunk to ${line.size}`)
  assert.ok(line.size >= 5 - 0.01, 'never below half the chosen size')

  // It runs past the right edge of its box, into the margin, but stops at the
  // page margin (36 pt from the right edge).
  const boxRight = (datesBox.x + datesBox.w) * viewport.width
  assert.ok(line.text.endsWith('09/18/2026'))
  assert.ok(line.x < boxRight, 'it starts inside the box')
  assert.ok(line.x + line.width > boxRight, 'it uses the free space to the right')
  assert.ok(line.x + line.width <= viewport.width - 36 + 0.5, `ends at ${line.x + line.width}`)
})

test('a list that fits its box keeps the chosen size', async () => {
  const { bytes } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor(rectField('waiver_release_dates', 'MM/DD/YYYY', datesBox)),
    values: { waiver_release_dates: ['2026-09-20', '2026-10-05'] },
  })
  const line = (await readBack(bytes)).items.find((item) => item.text.startsWith('09/20/2026'))
  assert.ok(Math.abs(line.size - 10) < 0.01, `size ${line.size}`)
})

// --- Real templates (ignored by git; skipped when the folder is missing) ------

const fixtures = new URL('../../../fixtures/private/releases/', import.meta.url)
const fixture = (name) => new URL(name, fixtures)

test('the Conditional Progress template with a damaged form is filled and cleaned', { skip: !existsSync(fixture('conditional-progress.pdf')) }, async () => {
  // Boxes of this form, as the analysis reports them (from its fields).
  const mapping = mappingFor(
    rectField('through_date', 'MM/DD/YYYY', { x: 0.2271, y: 0.3434, w: 0.3121, h: 0.0189 }),
    rectField('check_amount', 'currency', { x: 0.268, y: 0.5442, w: 0.317, h: 0.0189 }),
    rectField('waiver_release_dates', 'MM/DD/YYYY', { x: 0.397, y: 0.7083, w: 0.3611, h: 0.0164 }),
    rectField('unpaid_progress_amount', 'currency', { x: 0.4967, y: 0.7247, w: 0.2614, h: 0.0139 }),
    rectField('signature_date', 'MM/DD/YYYY', { x: 0.2533, y: 0.8668, w: 0.3171, h: 0.0189 }),
  )
  const source = readFileSync(fixture('conditional-progress.pdf'))
  assert.ok((await readBack(source)).widgets > 0, 'the template has form fields')

  const { bytes, filled } = await fillReleasePdf({
    pdfBytes: new Uint8Array(source),
    mapping,
    values: {
      through_date: '2026-09-30',
      check_amount: 1250,
      waiver_release_dates: '2026-08-15',
      unpaid_progress_amount: '300.5',
      signature_date: '2026-10-08',
    },
  })

  assert.equal(filled.length, 5)
  const { items, widgets } = await readBack(bytes)
  assert.equal(widgets, 0)
  const texts = items.map((item) => item.text)
  for (const expected of ['09/30/2026', '$1,250.00', '08/15/2026', '$300.50', '10/08/2026']) {
    assert.ok(texts.includes(expected), expected)
  }
  assert.ok(texts.some((text) => text.includes('CONDITIONAL WAIVER AND RELEASE')), 'the printed form is intact')
  assert.ok(items.filter((item) => ['09/30/2026', '$1,250.00'].includes(item.text)).every((item) => item.upright))
})

test('the partly filled flat template keeps what was already printed', { skip: !existsSync(fixture('prefilled-conditional-progress.pdf')) }, async () => {
  const { bytes } = await fillReleasePdf({
    pdfBytes: new Uint8Array(readFileSync(fixture('prefilled-conditional-progress.pdf'))),
    mapping: mappingFor(rectField('through_date', 'MM/DD/YYYY', { x: 0.2271, y: 0.3434, w: 0.3121, h: 0.0189 })),
    values: { through_date: '2026-09-30' },
  })
  const texts = (await readBack(bytes)).items.map((item) => item.text)
  assert.ok(texts.includes('09/30/2026'))
  assert.ok(texts.some((text) => text.includes('FILLED PREVIOUSLY')))
})

const signatureDate = rectField('signature_date', 'MM/DD/YYYY', { x: 0.25, y: 0.78, w: 0.32, h: 0.02 })

for (const rotation of [0, 90, 180, 270]) {
  test(`the footer note sits centered under the Date of Signature, upright, on a page rotated ${rotation}`, async () => {
    const { bytes } = await fillReleasePdf({
      pdfBytes: await blankPdf({ rotation }),
      mapping: mappingFor(signatureDate),
      values: { signature_date: '2026-09-30' },
      footerNote: 'Final release per Phase: Phase 5',
    })

    const { items, viewport } = await readBack(bytes)
    const date = items.find((item) => item.text === '09/30/2026')
    const note = items.find((item) => item.text === 'Final release per Phase: Phase 5')

    assert.ok(date && note, 'the date and the note are present')
    assert.equal(note.upright, true)
    // Below the signature date line, not beside it.
    assert.ok(note.y > date.y + 8, `note ${note.y} is under the date ${date.y}`)
    // Centered on the displayed page.
    const centre = note.x + note.width / 2
    assert.ok(Math.abs(centre - viewport.width / 2) < 3, `centered: ${centre} vs ${viewport.width / 2}`)
    // And inside the page.
    assert.ok(note.x >= 36 && note.x + note.width <= viewport.width - 36)
  })
}

test('the footer note is red and the values stay black', async () => {
  const { bytes } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor(signatureDate),
    values: { signature_date: '2026-09-30' },
    footerNote: 'Final release per Phase: Phase 5',
  })
  const colors = await fillColors(bytes)

  assert.equal(colors.get('Final release per Phase: Phase 5'), '#ff0000')
  assert.equal(colors.get('09/30/2026'), '#000000')
})

test('the footer note goes near the foot of the last page when there is no signature date box', async () => {
  const { bytes } = await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor(rectField('through_date', 'MM/DD/YYYY', { x: 0.25, y: 0.3, w: 0.3, h: 0.03 })),
    values: { through_date: '2026-09-30' },
    footerNote: 'Final release per Project (Job #1307)',
  })
  const { items, viewport } = await readBack(bytes)
  const note = items.find((item) => item.text.startsWith('Final release per Project'))

  assert.ok(note)
  assert.ok(note.y > viewport.height * 0.85 && note.y < viewport.height * 0.95)
})

test('a long footer note shrinks to fit between the margins and nothing is added without one', async () => {
  const long = `Final release per Building: ${'Phase 12 - Building 45, '.repeat(8)}`.trim()
  const { items, viewport } = await readBack((await fillReleasePdf({
    pdfBytes: await blankPdf(),
    mapping: mappingFor(signatureDate),
    values: { signature_date: '2026-09-30' },
    footerNote: long,
  })).bytes)
  const note = items.find((item) => item.text.startsWith('Final release per Building'))
  assert.ok(note.x >= 35.5 && note.x + note.width <= viewport.width - 35.5)

  for (const footerNote of [undefined, null, '', '   ']) {
    const { items: plain } = await readBack((await fillReleasePdf({
      pdfBytes: await blankPdf(),
      mapping: mappingFor(signatureDate),
      values: { signature_date: '2026-09-30' },
      footerNote,
    })).bytes)
    assert.equal(plain.some((item) => item.text.includes('Final release')), false)
  }
})
