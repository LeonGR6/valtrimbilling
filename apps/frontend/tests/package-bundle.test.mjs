import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import {
  buildPackageBundleFileName,
  describeStoredBundle,
  hasGeneratedPackage,
  mergePdfs,
  pickStoredBundleDocuments,
} from '../src/features/draw-invoice/services/packageBundle.js'

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

const stored = (name, completedAt) => ({ id: name, completedAt, file: { name, bucket: 'package-documents', storagePath: name } })

test('a Package counts as generated once its Release or its Payment Schedule is saved', () => {
  assert.equal(hasGeneratedPackage(), false)
  assert.equal(hasGeneratedPackage({ releases: [], schedules: [] }), false)
  assert.equal(hasGeneratedPackage({ releases: [stored('r', '2026-10-20')] }), true)
  assert.equal(hasGeneratedPackage({ schedules: [stored('s', '2026-10-20')] }), true)
})

test('the generated Package is put together as it is joined: invoice, Release, Payment Schedule', () => {
  const parts = pickStoredBundleDocuments({
    hasInvoice: true,
    releases: [stored('release.pdf', '2026-10-20')],
    schedules: [stored('schedule.pdf', '2026-10-21')],
  })

  assert.deepEqual(parts.map((part) => part.key), ['invoice', 'release', 'schedule'])
  assert.deepEqual(parts.map((part) => part.file?.name), [undefined, 'release.pdf', 'schedule.pdf'])
})

test('the Purchase Orders behind the options are joined after the Payment Schedule', () => {
  const order = (name) => ({ documentId: name, file: { name, bucket: 'job-documents', storagePath: name } })
  const parts = pickStoredBundleDocuments({
    hasInvoice: true,
    releases: [stored('release.pdf', '2026-10-20')],
    schedules: [stored('schedule.pdf', '2026-10-21')],
    purchaseOrders: [order('po-1.pdf'), order('po-2.pdf')],
  })

  assert.deepEqual(parts.map((part) => part.key), [
    'invoice', 'release', 'schedule', 'purchase-order', 'purchase-order',
  ])
  assert.deepEqual(parts.slice(3).map((part) => part.file.name), ['po-1.pdf', 'po-2.pdf'])

  // An order whose PDF is not there is left out, and so are Purchase Orders when there are none.
  assert.deepEqual(
    pickStoredBundleDocuments({ purchaseOrders: [{ documentId: 9, file: null }] }),
    [],
  )
  assert.deepEqual(pickStoredBundleDocuments({ hasInvoice: true }).map((part) => part.key), ['invoice'])
})

test('a document generated again is taken in its newest version, and missing ones are skipped', () => {
  const parts = pickStoredBundleDocuments({
    releases: [
      stored('old.pdf', '2026-10-18T10:00:00Z'),
      stored('new.pdf', '2026-10-20T09:00:00Z'),
      stored('middle.pdf', '2026-10-19T12:00:00Z'),
    ],
  })

  assert.deepEqual(parts.map((part) => [part.key, part.file.name]), [['release', 'new.pdf']])
  assert.deepEqual(pickStoredBundleDocuments({ hasInvoice: true }).map((part) => part.key), ['invoice'])
  assert.deepEqual(pickStoredBundleDocuments(), [])
})

test('the view says the Purchase Orders come from the Job, not from the Package', () => {
  const part = (key, label) => ({ key, label })
  assert.equal(
    describeStoredBundle([
      part('invoice', 'Invoice'),
      part('release', 'Release'),
      part('purchase-order', 'Purchase Order'),
      part('purchase-order', 'Purchase Order'),
    ]),
    'Invoice and Release saved on this Package · 2 Purchase Orders from the Job',
  )
  assert.equal(describeStoredBundle([part('purchase-order', 'Purchase Order')]), '1 Purchase Order from the Job')
})

test('the view says which saved documents it is joined from', () => {
  const part = (label) => ({ key: label, label })
  assert.equal(
    describeStoredBundle([part('Invoice'), part('Release'), part('Payment Schedule')]),
    'Invoice, Release and Payment Schedule saved on this Package',
  )
  assert.equal(describeStoredBundle([part('Release'), part('Payment Schedule')]), 'Release and Payment Schedule saved on this Package')
  assert.equal(describeStoredBundle([part('Release')]), 'Release saved on this Package')
  assert.equal(describeStoredBundle([]), '')
})
