import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterJobsForDocuments,
  jobDocumentBuilderOptions,
  jobDocumentCommunityOptions,
  sortJobsMissingFirst,
} from '../src/features/draw-invoice/utils/jobDocumentFilters.js'

const jobs = [
  { id: 1, code: '1501', builderId: 7, builder: 'Separate HW Builder', community: 'Separate' },
  { id: 2, code: '1502', builderId: 7, builder: 'Separate HW Builder', community: 'Lakes' },
  { id: 3, code: '1601', builderId: 9, builder: 'Acme Builder', community: 'Stone Creek' },
  { id: 4, code: '1602', builderId: 9, builder: 'Acme Builder', community: 'Lakes' },
]

test('document Builder options are unique and sorted by name', () => {
  assert.deepEqual(jobDocumentBuilderOptions(jobs), [
    { id: '9', name: 'Acme Builder' },
    { id: '7', name: 'Separate HW Builder' },
  ])
})

test('document Community options follow the chosen Builder', () => {
  assert.deepEqual(jobDocumentCommunityOptions(jobs), ['Lakes', 'Separate', 'Stone Creek'])
  assert.deepEqual(jobDocumentCommunityOptions(jobs, '9'), ['Lakes', 'Stone Creek'])
  assert.deepEqual(jobDocumentCommunityOptions(jobs, 7), ['Lakes', 'Separate'])
})

test('document Jobs filter by Builder, Community and search together', () => {
  const codes = (filters) => filterJobsForDocuments(jobs, filters).map(({ code }) => code)

  assert.deepEqual(codes({}), ['1501', '1502', '1601', '1602'])
  assert.deepEqual(codes({ builderId: '7' }), ['1501', '1502'])
  assert.deepEqual(codes({ community: 'Lakes' }), ['1502', '1602'])
  assert.deepEqual(codes({ builderId: '9', community: 'Lakes' }), ['1602'])
  assert.deepEqual(codes({ builderId: '9', community: 'Separate' }), [])
  assert.deepEqual(codes({ search: ' acme ' }), ['1601', '1602'])
  assert.deepEqual(codes({ builderId: '7', search: '1502' }), ['1502'])
})

test('Jobs missing documents are listed first without reordering the rest', () => {
  const missing = new Set([3, 1])

  assert.deepEqual(
    sortJobsMissingFirst(jobs, (job) => missing.has(job.id)).map(({ id }) => id),
    [1, 3, 2, 4],
  )
  assert.deepEqual(sortJobsMissingFirst(jobs).map(({ id }) => id), [1, 2, 3, 4])
})
