import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { buildPackageBundleFileName, mergePdfs } from '../src/features/draw-invoice/services/packageBundle.js'

async function pdf(pages, label) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let index = 1; index <= pages; index += 1) {
    doc.addPage([612, 792]).drawText(`${label} ${index}`, { x: 50, y: 700, size: 12, font })
  }
  return new Uint8Array(await doc.save())
}

test('the documents are joined one after the other, in the order given', async () => {
  const { bytes, pageCount } = await mergePdfs([await pdf(2, 'Release'), await pdf(3, 'Schedule')])
  assert.equal(pageCount, 5)
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 5)
})

test('a single document comes back whole, and nothing to join is an error', async () => {
  assert.equal((await mergePdfs([await pdf(1, 'Only')])).pageCount, 1)
  await assert.rejects(() => mergePdfs([]), /no documents to join/)
})

test('the joined file is named after the Job and the Package', () => {
  assert.equal(
    buildPackageBundleFileName({ jobCode: '1318', packageNumber: 'DP-00000046' }),
    'Package - Job 1318 - DP-00000046.pdf',
  )
  assert.equal(buildPackageBundleFileName({ jobCode: 'A/B', packageNumber: '' }), 'Package - Job A B.pdf')
})
