import assert from 'node:assert/strict'
import test from 'node:test'
import { degrees, PDFArray, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { buildPackageSchedulePdf } from '../src/features/payment-schedules/services/packageSchedulePdf.js'

async function samplePdf({ pages = 1, rotation = 0 } = {}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([612, 792])
    page.drawText(`Amount ${index + 1}: 1,611.90`, { x: 100, y: 600, size: 10, font })
    if (rotation) page.setRotation(degrees(rotation))
  }
  return new Uint8Array(await doc.save())
}

const cell = (page, rect = { x: 0.15, y: 0.2, w: 0.1, h: 0.02 }) => ({ page, rect })
const text = (bytes) => Buffer.from(bytes).toString('latin1')

test('the highlight is a multiplied yellow box, so the amount under it stays readable', async () => {
  const { bytes, pageCount, highlighted } = await buildPackageSchedulePdf([
    { pdfBytes: await samplePdf(), cells: [cell(1), cell(1, { x: 0.3, y: 0.3, w: 0.1, h: 0.02 })] },
  ])

  assert.equal(pageCount, 1)
  assert.equal(highlighted, 2)
  assert.match(text(bytes), /\/BM \/Multiply/)
  // The original text is still in the file.
  const reloaded = await PDFDocument.load(bytes)
  assert.equal(reloaded.getPageCount(), 1)
})

test('cells on a page that does not exist are skipped instead of failing', async () => {
  const { highlighted, pageCount } = await buildPackageSchedulePdf([
    { pdfBytes: await samplePdf(), cells: [cell(1), cell(5)] },
  ])
  assert.deepEqual([highlighted, pageCount], [1, 1])
})

test('rotated pages are highlighted too', async () => {
  for (const rotation of [90, 180, 270]) {
    const { bytes, highlighted } = await buildPackageSchedulePdf([
      { pdfBytes: await samplePdf({ rotation }), cells: [cell(1)] },
    ])
    assert.equal(highlighted, 1, String(rotation))
    assert.match(text(bytes), /\/Multiply/, String(rotation))
  }
})

test('several schedules are joined, in order, into one PDF', async () => {
  const { bytes, pageCount, highlighted } = await buildPackageSchedulePdf([
    { pdfBytes: await samplePdf({ pages: 2 }), cells: [cell(2)] },
    { pdfBytes: await samplePdf({ pages: 3 }), cells: [cell(1), cell(3)] },
  ])
  assert.equal(pageCount, 5)
  assert.equal(highlighted, 3)
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 5)
})

test('nothing to highlight is an error, not an empty PDF', async () => {
  await assert.rejects(() => buildPackageSchedulePdf([]), /nothing to highlight/)
})

async function pageText(bytes, pageNumber = 1) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await task.promise
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  const items = content.items.map((item) => ({
    text: item.str, x: item.transform[4], y: item.transform[5], size: Math.abs(item.transform[0]),
  }))
  await task.destroy()
  return items
}

test('values are written in their boxes, black, to the right and centered on the line', async () => {
  const rect = { x: 0.5, y: 0.5, w: 0.1, h: 0.014 } // 61 x 11 points
  const { bytes, filled } = await buildPackageSchedulePdf([{
    pdfBytes: await samplePdf(),
    cells: [],
    fills: [{ page: 1, rect, text: '28,107.36' }],
  }])
  assert.equal(filled, 1)

  const written = (await pageText(bytes)).find((item) => item.text === '28,107.36')
  assert.ok(written, 'the value is in the PDF')
  // Inside its box: from 306 to 367 across, and 792 * (1 - 0.514) to 792 * 0.5 from the bottom.
  assert.ok(written.x >= 306 && written.x < 310, `x ${written.x}`)
  const bottom = 792 * (1 - 0.514)
  const top = 792 * 0.5
  assert.ok(written.y > bottom && written.y < top, `y ${written.y}`)
  assert.ok(written.size <= 9 && written.size >= 5)
})

test('a long value shrinks to fit the box width', async () => {
  const narrow = { x: 0.5, y: 0.5, w: 0.05, h: 0.014 } // about 30 points
  const { bytes } = await buildPackageSchedulePdf([{
    pdfBytes: await samplePdf(),
    cells: [],
    fills: [{ page: 1, rect: narrow, text: '1,234,567.89' }, { page: 1, rect: { ...narrow, y: 0.6 }, text: '5.00' }],
  }])
  const items = await pageText(bytes)
  const long = items.find((item) => item.text === '1,234,567.89')
  const short = items.find((item) => item.text === '5.00')
  assert.ok(long.size < short.size, `${long.size} < ${short.size}`)
})

test('values on rotated pages and on pages that do not exist', async () => {
  const rect = { x: 0.3, y: 0.3, w: 0.1, h: 0.02 }
  const { filled } = await buildPackageSchedulePdf([{
    pdfBytes: await samplePdf({ rotation: 90 }),
    cells: [],
    fills: [{ page: 1, rect, text: '10.00' }, { page: 9, rect, text: '20.00' }],
  }])
  assert.equal(filled, 1)
})

// Adds a FreeText annotation, as a person typing a number on the PDF does.
function addTypedValue(doc, [left, bottom, right, top], contents) {
  const annotation = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: [left, bottom, right, top],
    Contents: PDFString.of(contents),
  }))
  const page = doc.getPages()[0]
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (existing) existing.push(annotation)
  else page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]))
}

async function typedValues(bytes) {
  const doc = await PDFDocument.load(bytes)
  const annotations = doc.getPages()[0].node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  return annotations ? annotations.asArray().map((ref) => doc.context.lookup(ref).get(PDFName.of('Contents')).decodeText()) : []
}

test('values typed by hand into the rows are replaced, and others are left alone', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  addTypedValue(doc, [300, 400, 360, 412], '28107.36')   // in the box below
  addTypedValue(doc, [100, 100, 160, 112], 'a note')      // elsewhere on the page
  const pdfBytes = new Uint8Array(await doc.save())

  // A box around (306..367, 396..407) in PDF points, as a top-left rectangle.
  const rect = { x: 306 / 612, y: (792 - 407) / 792, w: 61 / 612, h: 11 / 792 }
  const { bytes, replaced } = await buildPackageSchedulePdf([{
    pdfBytes, cells: [], fills: [{ page: 1, rect, text: '1.00' }], fillBoxes: [{ page: 1, rect }],
  }])

  assert.equal(replaced, 1)
  assert.deepEqual(await typedValues(bytes), ['a note'])
})

test('a typed value is removed even when the draw has nothing to write', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  addTypedValue(doc, [300, 400, 360, 412], '123.00')
  const rect = { x: 306 / 612, y: (792 - 407) / 792, w: 61 / 612, h: 11 / 792 }
  const { bytes, replaced, filled } = await buildPackageSchedulePdf([{
    pdfBytes: new Uint8Array(await doc.save()), cells: [{ page: 1, rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.01 } }], fills: [], fillBoxes: [{ page: 1, rect }],
  }])
  assert.deepEqual([replaced, filled], [1, 0])
  assert.deepEqual(await typedValues(bytes), [])
})

test('without summary boxes nothing is removed', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  addTypedValue(doc, [300, 400, 360, 412], '123.00')
  const { bytes, replaced } = await buildPackageSchedulePdf([{
    pdfBytes: new Uint8Array(await doc.save()), cells: [{ page: 1, rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.01 } }],
  }])
  assert.equal(replaced, 0)
  assert.deepEqual(await typedValues(bytes), ['123.00'])
})
