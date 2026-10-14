import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { degrees, PDFDocument } from '@cantoo/pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  buildFieldEntries,
  fitFieldFontSize,
  isPrintableNoticeText,
  readNoticePages,
  writeNoticeText,
  describeEntriesProblem,
} from '../src/features/draw-invoice/services/preliminaryNoticePdf.js'
import {
  applyFieldValue,
  fieldValuesChanged,
  initialFieldValues,
  isRequiredField,
  linkedFieldIds,
  missingRequiredFields,
} from '../src/features/draw-invoice/services/preliminaryNoticeRules.js'
import { detectFieldsInPage } from '../src/features/draw-invoice/services/preliminaryNoticeFields.js'
import {
  isFirstPackageOfJob,
  preliminaryNoticeGate,
} from '../src/features/draw-invoice/utils/preliminaryNotice.js'

async function blankPdf({ rotation = 0 } = {}) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  if (rotation) page.setRotation(degrees(rotation))
  doc.addPage([300, 400])
  return doc.save()
}

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
  const items = content.items
    .filter((item) => item.str.trim() !== '')
    .map((item) => {
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
      const [a, b] = pdfjs.Util.transform(viewport.transform, item.transform)
      return { text: item.str, x, y, upright: a > 0 && Math.abs(b) < 1e-6 }
    })
  await pdf.loadingTask.destroy()
  return { items, viewport }
}

const entry = (extra = {}) => ({
  id: 'a',
  page: 1,
  x: 0.25,
  y: 0.5,
  text: 'Job 1318',
  fontSize: 12,
  ...extra,
})

test('the first Package of a Job needs its Preliminary Notice', () => {
  const packages = [{ jobId: 7 }]

  assert.equal(isFirstPackageOfJob(packages, 8), true)
  assert.equal(isFirstPackageOfJob(packages, '7'), false)

  assert.deepEqual(
    preliminaryNoticeGate({ jobId: 8, packages, hasNotice: false }),
    { required: true, status: 'missing', blocked: true },
  )
  assert.deepEqual(
    preliminaryNoticeGate({ jobId: 8, packages, hasNotice: null }),
    { required: true, status: 'loading', blocked: true },
  )
  assert.deepEqual(
    preliminaryNoticeGate({ jobId: 8, packages, hasNotice: true }),
    { required: true, status: 'present', blocked: false },
  )
})

test('a Job that already has a Package is never blocked again', () => {
  const packages = [{ jobId: 7 }]

  assert.deepEqual(
    preliminaryNoticeGate({ jobId: 7, packages, hasNotice: false }),
    { required: false, status: 'not-needed', blocked: false },
  )
  assert.equal(preliminaryNoticeGate({ jobId: '', packages, hasNotice: false }).blocked, false)
})

test('the editor lays out the pages of the PDF with their rotation', async () => {
  const pages = await readNoticePages(await blankPdf({ rotation: 90 }))

  assert.deepEqual(pages, [
    { page: 1, width: 612, height: 792, rotation: 90 },
    { page: 2, width: 300, height: 400, rotation: 0 },
  ])
  await assert.rejects(() => readNoticePages(new Uint8Array([1, 2, 3])), /could not be read/)
})

test('typed text lands where it was placed on the displayed page', async () => {
  const bytes = await writeNoticeText({
    pdfBytes: await blankPdf(),
    entries: [entry(), entry({ id: 'b', page: 2, x: 0.1, y: 0.1, text: 'Page two' })],
  })

  const first = await readBack(bytes, 1)
  assert.equal(first.items.length, 1)
  assert.equal(first.items[0].text, 'Job 1318')
  assert.ok(Math.abs(first.items[0].x - 612 * 0.25) < 1)
  // The baseline sits a little above the bottom of the line that starts at y.
  const lineBottom = 792 * 0.5 + 12 * 1.25
  assert.ok(first.items[0].y < lineBottom && first.items[0].y > lineBottom - 6)

  const second = await readBack(bytes, 2)
  assert.equal(second.items[0].text, 'Page two')
})

test('text stays upright on a rotated page', async () => {
  for (const rotation of [90, 180, 270]) {
    const bytes = await writeNoticeText({
      pdfBytes: await blankPdf({ rotation }),
      entries: [entry({ x: 0.2, y: 0.3 })],
    })
    const { items, viewport } = await readBack(bytes, 1)

    assert.equal(items.length, 1, `rotation ${rotation}`)
    assert.equal(items[0].upright, true, `rotation ${rotation}`)
    assert.ok(Math.abs(items[0].x - viewport.width * 0.2) < 1, `rotation ${rotation}`)
  }
})

test('empty texts are skipped and unprintable ones are refused', async () => {
  const bytes = await writeNoticeText({
    pdfBytes: await blankPdf(),
    entries: [entry({ text: '   ' })],
  })
  assert.equal((await readBack(bytes, 1)).items.length, 0)

  assert.equal(isPrintableNoticeText('Peña Nº 5'), true)
  assert.equal(isPrintableNoticeText('日本語'), false)
  assert.match(describeEntriesProblem([entry({ text: '日本語' })]), /characters a PDF cannot print/)
  await assert.rejects(
    () => writeNoticeText({ pdfBytes: new Uint8Array(), entries: [entry({ text: '日本語' })] }),
    /cannot print/,
  )
})

// --- Detected blanks ---------------------------------------------------------

async function detectIn(bytes) {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise
  const fields = []
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number)
    const content = await page.getTextContent()
    fields.push(...detectFieldsInPage({
      page: number,
      operatorList: await page.getOperatorList(),
      OPS: pdfjs.OPS,
      viewport: page.getViewport({ scale: 1 }),
      textItems: content.items,
    }))
  }
  await pdf.loadingTask.destroy()
  return fields
}

const californiaNotice = () => readFileSync(
  new URL('../src/features/draw-invoice/assets/california-preliminary-notice.pdf', import.meta.url),
)

test('every blank and check box of the California notice is found', async () => {
  const fields = await detectIn(californiaNotice())
  const texts = fields.filter((field) => field.kind === 'text')
  const checks = fields.filter((field) => field.kind === 'check')

  assert.equal(texts.length, 27)
  assert.equal(checks.length, 10)
  // The divider above the declaration is not a blank.
  assert.equal(fields.some((field) => Math.abs(field.y * 792 - (701.4 - 14)) < 1), false)

  const labels = fields.map((field) => field.label)
  assert.ok(labels.includes('TO: Owner or reputed owner · Name'))
  assert.ok(labels.includes('Construction or reputed lender (if any) · Address (cont.)'))
  assert.ok(labels.includes('Printed name'))
  assert.ok(labels.includes('Certified'))

  // Reading order: top to bottom, then left to right.
  const tops = fields.map((field) => field.y + field.h)
  assert.deepEqual(
    [...tops].sort((left, right) => Math.round(left * 132) - Math.round(right * 132)),
    tops,
  )
  assert.equal(new Set(fields.map((field) => field.id)).size, fields.length)
})

test('a blank sits on its printed line and a check box on its square', async () => {
  const fields = await detectIn(californiaNotice())
  const owner = fields.find((field) => field.label === 'TO: Owner or reputed owner · Name')
  const certified = fields.find((field) => field.label === 'Certified')

  assert.ok(Math.abs(owner.x * 612 - 69) < 0.5)
  assert.ok(Math.abs((owner.y + owner.h) * 792 - 260.4) < 0.5)
  assert.ok(Math.abs(owner.w * 612 - 133) < 0.5)
  assert.ok(Math.abs(certified.x * 612 - 257) < 0.5)
  assert.ok(Math.abs(certified.w * 612 - 7) < 0.5)
})

test('a PDF with no printed blanks has no fields', async () => {
  assert.deepEqual(await detectIn(await blankPdf()), [])
})

test('typed blanks and marked boxes are written where they were found', async () => {
  const source = californiaNotice()
  const fields = await detectIn(source)
  const name = fields.find((field) => field.label === 'TO: Owner or reputed owner · Name')
  const certified = fields.find((field) => field.label === 'Certified')
  const entries = buildFieldEntries(fields, {
    [name.id]: 'Jane Homeowner',
    [certified.id]: true,
  })
  assert.equal(entries.length, 2)

  const bytes = await writeNoticeText({ pdfBytes: source, entries })
  const { items } = await readBack(bytes, 1)
  const written = items.find((item) => item.text === 'Jane Homeowner')

  assert.ok(written)
  assert.equal(written.upright, true)
  assert.ok(written.x > 69 && written.x < 75)
  // The baseline is just above the printed line.
  assert.ok(written.y < 260.4 && written.y > 255)

  // The X is drawn as two strokes inside the square: more path operators than before.
  const countStrokes = async (pdfBytes) => {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false, verbosity: 0 }).promise
    const list = await (await pdf.getPage(1)).getOperatorList()
    await pdf.loadingTask.destroy()
    return list.fnArray.filter((operator) => operator === pdfjs.OPS.constructPath).length
  }
  assert.ok(await countStrokes(bytes) >= (await countStrokes(source)) + 2)
})

test('a long text shrinks to stay inside its blank', async () => {
  const fields = await detectIn(californiaNotice())
  const name = fields.find((field) => field.label === 'TO: Owner or reputed owner · Name')
  const text = 'A rather long owner name for the line'
  const bytes = await writeNoticeText({
    pdfBytes: californiaNotice(),
    entries: buildFieldEntries(fields, { [name.id]: text }),
  })
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise
  const content = await (await pdf.getPage(1)).getTextContent()
  const item = content.items.find((candidate) => candidate.str === text)
  await pdf.loadingTask.destroy()

  assert.ok(item.width <= 133 - 4 + 0.5)
  assert.equal(fitFieldFontSize({ size: 10, textWidth: 100, maxWidth: 200 }), 10)
  assert.equal(fitFieldFontSize({ size: 10, textWidth: 400, maxWidth: 200 }), 5)
  assert.equal(fitFieldFontSize({ size: 10, textWidth: 1000, maxWidth: 200 }), 5)
})

// --- Printing rules ----------------------------------------------------------

test('only the signature, the current demand, the attachments, personal delivery and second address lines may stay empty', async () => {
  const fields = await detectIn(californiaNotice())
  const required = fields.filter(isRequiredField)
  const optional = fields.filter((field) => field.kind === 'text' && !isRequiredField(field))

  assert.deepEqual(optional.map(({ label }) => label).sort(), [
    'A. Personal delivery to (name and title)',
    'At (address)',
    'Construction or reputed lender (if any) · Address (cont.)',
    'Current demand, if any, less credits / offsets',
    'Direct or reputed direct contractor · Address (cont.)',
    'Notice attachments / pages',
    'On (date / time)',
    'Signature',
    'TO: Owner or reputed owner · Address (cont.)',
  ])
  assert.equal(required.length, 18)
  // Check boxes are choices, never required.
  assert.equal(fields.filter((field) => field.kind === 'check').some(isRequiredField), false)

  assert.equal(missingRequiredFields(fields, {}).length, 18)
  const filledAll = Object.fromEntries(required.map(({ id }) => [id, 'x']))
  assert.equal(missingRequiredFields(fields, filledAll).length, 0)
  // A blank with only spaces is still empty.
  assert.equal(
    missingRequiredFields(fields, { ...filledAll, [required[0].id]: '   ' }).length,
    1,
  )
})

test('the Direct Contractor and the person the work is for share name and address', async () => {
  const fields = await detectIn(californiaNotice())
  const links = linkedFieldIds(fields)
  const byLabel = (label) => fields.find((field) => field.label === label)
  const contractorName = byLabel('Direct or reputed direct contractor · Name')
  const contractorAddress = byLabel('Direct or reputed direct contractor · Address')
  const personName = byLabel('Name')
  const personAddress = byLabel('Address')

  assert.deepEqual(links.get(contractorName.id), [contractorName.id, personName.id])
  assert.deepEqual(links.get(personAddress.id), [contractorAddress.id, personAddress.id])
  // The owner's and the lender's blanks stay their own.
  assert.equal(links.has(byLabel('TO: Owner or reputed owner · Name').id), false)

  // Typing in either one fills both, and only those two.
  const fromContractor = applyFieldValue({}, links, contractorName.id, 'Acme Builders')
  assert.deepEqual(fromContractor, { [contractorName.id]: 'Acme Builders', [personName.id]: 'Acme Builders' })
  const fromPerson = applyFieldValue(fromContractor, links, personName.id, 'Acme Homes')
  assert.equal(fromPerson[contractorName.id], 'Acme Homes')
  assert.deepEqual(applyFieldValue({}, links, 'p1-1', 'Owner'), { 'p1-1': 'Owner' })
})

test('the name of the declaration is the printed name of whoever signs', async () => {
  const fields = await detectIn(californiaNotice())
  const links = linkedFieldIds(fields)
  const declared = fields.find((field) => field.label === 'I,')
  const printed = fields.find((field) => field.label === 'Printed name')

  assert.deepEqual(links.get(declared.id), [declared.id, printed.id])
  const typed = applyFieldValue({}, links, printed.id, 'Jane Doe')
  assert.deepEqual(typed, { [declared.id]: 'Jane Doe', [printed.id]: 'Jane Doe' })
})

test('a blank notice starts with the usual recipients, mail service and Certified marked', async () => {
  const fields = await detectIn(californiaNotice())
  const marked = initialFieldValues(fields)
  const labelsOf = (ids) => ids.map((id) => fields.find((field) => field.id === id).label)

  assert.deepEqual(labelsOf(Object.keys(marked)), [
    'Owner',
    'Direct contractor',
    'Construction lender',
    'B. Mail / carrier service (select actual method)',
    'Certified',
  ])
  assert.ok(Object.values(marked).every((value) => value === true))
  // Personal delivery and substituted service stay unmarked.
  assert.equal(labelsOf(Object.keys(marked)).some((label) => label.startsWith('A.') || label.startsWith('C.')), false)

  // The marks alone are not something the person typed.
  assert.equal(fieldValuesChanged(marked, marked), false)
  assert.equal(fieldValuesChanged({ ...marked, 'p1-1': 'Acme' }, marked), true)
  assert.equal(fieldValuesChanged({ ...marked, [Object.keys(marked)[0]]: false }, marked), true)
  assert.equal(fieldValuesChanged({ ...marked, 'p1-1': '' }, marked), false)
})

test('a form without those labels is not linked', () => {
  const links = linkedFieldIds([
    { id: 'a', kind: 'text', label: 'Name' },
    { id: 'b', kind: 'text', label: 'Address' },
  ])
  assert.equal(links.size, 0)
})
