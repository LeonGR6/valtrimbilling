import assert from 'node:assert/strict'
import test from 'node:test'
import {
  documentJobBuilderOptions,
  filterDocumentJobs,
  groupChangeOrdersByJob,
} from '../src/features/change-orders/utils/documentJobs.js'

const orders = [
  { id: 3, number: 'CO-0003', poCoNumber: 'PO 77', jobId: 20, jobCode: '1323', community: 'Monte Vista', builderId: 2, builderName: 'Olson' },
  { id: 2, number: 'CO-0002', poCoNumber: '', jobId: 10, jobCode: '1295', community: 'Indigo', builderId: 1, builderName: 'Lennar' },
  { id: 1, number: 'CO-0001', poCoNumber: '', jobId: 20, jobCode: '1323', community: 'Monte Vista', builderId: 2, builderName: 'Olson' },
]

test('Extras / COs are grouped by Job, Jobs by number, each keeping the list order', () => {
  const jobs = groupChangeOrdersByJob(orders)
  assert.deepEqual(jobs.map((job) => job.jobCode), ['1295', '1323'])
  assert.deepEqual(jobs[1].orders.map((order) => order.number), ['CO-0003', 'CO-0001'])
})

test('a Job with Purchase Orders and no Extra / CO yet gets its folder from the Job list', () => {
  const jobs = groupChangeOrdersByJob(orders, {
    poFilesByJob: {
      20: [{ id: 'a', name: 'SIMI.pdf' }],
      30: [{ id: 'b', name: 'HAVEN P6 L57.pdf' }],
      99: [{ id: 'c', name: 'GONE.pdf' }],
    },
    jobs: [{ id: 30, code: '1400', community: 'Haven', builderId: 3, builder: 'Trumark' }],
  })
  assert.deepEqual(jobs.map((job) => [job.jobCode, job.orders.length, job.poFiles.length]), [
    ['1295', 1, 0],
    ['1323', 2, 1],
    ['1400', 0, 1],
  ])
  assert.deepEqual(filterDocumentJobs(jobs, { search: 'haven p6' }).map((job) => job.jobCode), ['1400'])
})

test('the filter finds a Job by its Builder or by the PO / CO # of one of its Extras / COs', () => {
  const jobs = groupChangeOrdersByJob(orders)
  assert.deepEqual(filterDocumentJobs(jobs, { builderId: '1' }).map((job) => job.jobCode), ['1295'])
  assert.deepEqual(filterDocumentJobs(jobs, { search: 'po 77' }).map((job) => job.jobCode), ['1323'])
  assert.deepEqual(documentJobBuilderOptions(jobs).map((builder) => builder.name), ['Lennar', 'Olson'])
})
