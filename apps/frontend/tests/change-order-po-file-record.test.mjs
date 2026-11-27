import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupPoFilesByJob,
  poFileErrorMessage,
  poFileProblem,
  poFileStoragePath,
  sha256Hex,
  toPoFile,
} from '../src/features/change-orders/services/changeOrderPoFileRecord.js'

test('a stored row reads as a Purchase Order PDF and is grouped by its Job', () => {
  const file = toPoFile({
    id: 'f1', job_id: 12, storage_bucket: 'change-order-pos', storage_path: '12/f1.pdf',
    original_name: 'SIMI.pdf', size_bytes: '2048', content_sha256: 'ab', uploaded_by: 'u', created_at: 't',
  })
  assert.equal(file.sizeBytes, 2048)
  assert.equal(file.name, 'SIMI.pdf')
  assert.deepEqual(Object.keys(groupPoFilesByJob([file, { ...file, id: 'f2' }])), ['12'])
})

test('the Storage path starts with the Job, which is what Storage checks', () => {
  assert.equal(poFileStoragePath('12', 'abc'), '12/abc.pdf')
})

test('only PDFs of 25 MB or less can be uploaded', () => {
  assert.equal(poFileProblem({ name: 'po.pdf', size: 10 }), '')
  assert.equal(poFileProblem({ name: 'po.xlsx', size: 10 }), 'Only PDF files.')
  assert.equal(poFileProblem({ name: 'po.pdf', size: 0 }), 'The file is empty.')
  assert.equal(poFileProblem({ name: 'po.pdf', size: 26 * 1024 * 1024 }), 'The file is larger than 25 MB.')
})

test('the fingerprint is the SHA-256 of the bytes', async () => {
  const hex = await sha256Hex(new TextEncoder().encode('abc'))
  assert.equal(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('a copy already in the Job keeps the database message, which names the first upload', () => {
  const message = poFileErrorMessage({ code: '23505', message: 'This PDF was already uploaded to this Job as SIMI.pdf' }, 'x')
  assert.match(message, /as SIMI\.pdf/)
  assert.equal(poFileErrorMessage({ code: '42501' }, 'x'), 'You do not have permission to manage Purchase Orders.')
})

test('an order read from a PDF keeps its lines in order and its amounts as numbers', async () => {
  const { toPoOrder, groupPoOrdersByFile } = await import('../src/features/change-orders/services/changeOrderPoFileRecord.js')
  const order = toPoOrder({
    id: 1, file_id: 'f', job_id: 2, position: 1, po_number: '4400102/247', document_kind: 'CHANGE_ORDER',
    total_amount: '736.72', net_amount: null, pages: [1], other_numbers: [], warnings: [],
    change_order_po_lines: [
      { line_number: 2, lots: ['17'], amount: '184.18', lots_checked: true },
      { line_number: 1, lots: ['16'], amount: '184.18', lots_checked: true },
    ],
  })
  assert.equal(order.total, 736.72)
  assert.equal(order.kindLabel, 'Change Order')
  assert.deepEqual(order.lines.map((line) => line.lots[0]), ['16', '17'])
  assert.deepEqual(Object.keys(groupPoOrdersByFile([order])), ['f'])
})

test('the Lots of an order read in short, runs as ranges', async () => {
  const { describeOrderLots } = await import('../src/features/change-orders/services/changeOrderPoFileRecord.js')
  const lines = (...lots) => ({ lines: lots.map((lot) => ({ lots: lot })) })
  assert.equal(describeOrderLots(lines(['12', '13', '14', '15', '16', '17'])), 'Lots 12–17')
  assert.equal(describeOrderLots(lines(['10'], ['11'], ['16'], ['17'])), 'Lots 10, 11, 16, 17')
  assert.equal(describeOrderLots(lines(['48', '49', '50'], ['56'])), 'Lots 48–50, 56')
  assert.equal(describeOrderLots(lines([])), 'No Lot')
  assert.equal(describeOrderLots(lines(['H0051'])), 'Lot H0051')
})

test('a reading says where it stands', async () => {
  const { readStatusLabel } = await import('../src/features/change-orders/services/changeOrderPoFileRecord.js')
  assert.equal(readStatusLabel({ readStatus: 'READ' }, 3), '3 orders found')
  assert.equal(readStatusLabel({ readStatus: 'READ' }, 1), '1 order found')
  assert.equal(readStatusLabel({ readStatus: 'UNREAD' }, 0), 'Not read yet')
})
