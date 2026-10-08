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
      return { text: item.str, x, y, upright: a > 0 && Math.abs(b) < 1e-6, size: Math.abs(item.transform[0]) || item.height }
    })
  await pdf.loadingTask.destroy()
  return { items, widgets: annotations.filter((a) => a.subtype === 'Widget').length, viewport }
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
