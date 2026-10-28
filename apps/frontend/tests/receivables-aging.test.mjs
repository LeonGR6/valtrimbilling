import assert from 'node:assert/strict'
import test from 'node:test'
import { addDaysToKey } from '../src/features/dashboard/utils/dashboardDates.js'
import {
  AGING_BUCKETS,
  AGING_BUCKET_KEYS,
  agingBucketKey,
  agingBucketLabel,
  buildReceivableInvoices,
  californiaDateKey,
  daysPastDue,
  filterReceivables,
  groupReceivables,
  isReportDateAllowed,
  oldestPaymentCheck,
  receivableBuilderOptions,
  receivableJobOptions,
  sortReceivableGroups,
  sortReceivableInvoices,
  totalReceivables,
} from '../src/features/draw-invoice/utils/receivablesAging.js'
import { toReceivableRecord } from '../src/features/draw-invoice/services/receivablesRecord.js'
import { invoicePath } from '../src/features/draw-invoice/components/receivables/receivablesView.js'

const jobs = [
  { id: 101, code: '101', builder: 'Builder A', community: 'Oak Park' },
  { id: 102, code: '102', builder: 'Builder A', community: 'Oak Park' },
  { id: 103, code: '103', builder: 'Builder A', community: 'Pine Hills' },
  { id: 201, code: '201', builder: 'Builder B', community: 'Lakeside' },
]
const builderOf = { 101: 1, 102: 1, 103: 1, 201: 2 }
const REPORT_DATE = '2026-12-01'

let nextId = 1
// An open invoice that is `daysLate` days past its Due Date on REPORT_DATE.
function record(jobId, balance, daysLate, overrides = {}) {
  const id = nextId++
  return {
    packageId: id,
    packageNumber: `DP-${String(id).padStart(8, '0')}`,
    invoiceNumber: `INV-${String(id).padStart(3, '0')}`,
    builderId: builderOf[jobId],
    jobId,
    invoiceDate: addDaysToKey(REPORT_DATE, -daysLate - 30),
    dueDate: addDaysToKey(REPORT_DATE, -daysLate),
    originalAmount: balance,
    balance,
    paymentState: 'OPEN',
    checkedAt: '2026-12-01T17:00:00+00:00',
    ...overrides,
  }
}

function build(records, reportDate = REPORT_DATE) {
  return buildReceivableInvoices(records, { reportDate, jobs })
}

test('the example Due Date of November 30 moves from Current to 1–30 on December 1', () => {
  const due = '2026-11-30'
  const on = (reportDate) => {
    const days = daysPastDue(due, reportDate)
    return [days, agingBucketKey(days)]
  }

  assert.deepEqual(on('2026-11-29'), [-1, 'CURRENT'])
  assert.deepEqual(on('2026-11-30'), [0, 'CURRENT'])
  assert.deepEqual(on('2026-12-01'), [1, 'DAYS_1_30'])
  assert.deepEqual(on('2026-12-30'), [30, 'DAYS_1_30'])
  assert.deepEqual(on('2026-12-31'), [31, 'DAYS_31_60'])
})

test('every bucket edge belongs to exactly one bucket: 0, 1, 30, 31, 60, 61, 90 and 91 days', () => {
  const expected = [
    [-5, 'CURRENT'],
    [0, 'CURRENT'],
    [1, 'DAYS_1_30'],
    [30, 'DAYS_1_30'],
    [31, 'DAYS_31_60'],
    [60, 'DAYS_31_60'],
    [61, 'DAYS_61_90'],
    [90, 'DAYS_61_90'],
    [91, 'DAYS_91_PLUS'],
    [400, 'DAYS_91_PLUS'],
  ]

  for (const [days, bucket] of expected) {
    assert.equal(agingBucketKey(days), bucket, `${days} days`)
  }
})

test('the last bucket is called 91 & over, so day 90 is never read as part of it', () => {
  assert.deepEqual(
    AGING_BUCKETS.map(({ label }) => label),
    ['Current', '1–30 Days', '31–60 Days', '61–90 Days', '91 & over'],
  )
  assert.equal(agingBucketLabel('DAYS_91_PLUS'), '91 & over')
})

test('the edges hold for invoices built from real dates, not only from day counts', () => {
  const cases = [[0, 'CURRENT'], [1, 'DAYS_1_30'], [30, 'DAYS_1_30'], [31, 'DAYS_31_60'],
    [60, 'DAYS_31_60'], [61, 'DAYS_61_90'], [90, 'DAYS_61_90'], [91, 'DAYS_91_PLUS']]

  for (const [daysLate, bucket] of cases) {
    const [invoice] = build([record(101, 100, daysLate)])
    assert.equal(invoice.daysPastDue, daysLate)
    assert.equal(invoice.bucket, bucket, `${daysLate} days late`)
  }
})

test('days are counted on calendar days across month ends, leap years and daylight saving', () => {
  assert.equal(daysPastDue('2027-02-28', '2027-03-01'), 1)
  assert.equal(daysPastDue('2028-02-28', '2028-03-01'), 2)
  assert.equal(daysPastDue('2026-03-07', '2026-03-09'), 2)
  assert.equal(daysPastDue('2026-10-31', '2026-11-02'), 2)
  assert.equal(daysPastDue('2026-12-31', '2027-01-01'), 1)
})

test('an invoice with no usable Due Date has no days past due and stays Current', () => {
  const [missing, broken] = build([
    record(101, 100, 0, { dueDate: null }),
    record(101, 100, 0, { dueDate: 'soon' }),
  ])

  assert.equal(missing.daysPastDue, null)
  assert.equal(missing.bucket, 'CURRENT')
  assert.equal(broken.daysPastDue, null)
  assert.equal(broken.bucket, 'CURRENT')
})

test('a partly paid invoice counts only what is still owed, in the bucket its Due Date gives', () => {
  const [partly] = build([record(101, 3000, 45, { originalAmount: 5000, paymentState: 'PARTIALLY_PAID' })])

  assert.equal(partly.balanceCents, 300000)
  assert.equal(partly.originalCents, 500000)
  assert.equal(partly.bucket, 'DAYS_31_60')
  assert.equal(partly.daysPastDue, 45)
  assert.deepEqual(totalReceivables([partly]).buckets.DAYS_31_60, 300000)
})

test('a payment does not restart the days: the same Due Date gives the same days at any balance', () => {
  const [before] = build([record(101, 5000, 45)])
  const [after] = build([record(101, 1200, 45, { paymentState: 'PARTIALLY_PAID' })])

  assert.equal(before.daysPastDue, after.daysPastDue)
  assert.equal(before.bucket, after.bucket)
})

test('settled, closed, voided and deleted invoices are not receivable, even with an old balance copied', () => {
  const invoices = build([
    record(101, 0, 10, { paymentState: 'PAID' }),
    record(101, 800, 10, { paymentState: 'PAID' }),
    record(101, 800, 10, { paymentState: 'CLOSED' }),
    record(101, 800, 10, { paymentState: 'VOIDED' }),
    record(101, 800, 10, { paymentState: 'DELETED' }),
    record(101, null, 10),
    record(101, 800, 10, { paymentState: 'OVERDUE' }),
  ])

  assert.equal(invoices.length, 1)
  assert.equal(invoices[0].balanceCents, 80000)
})

test('a Job adds its invoices by bucket and shows no days of its own', () => {
  const invoices = build([
    record(101, 2500, 12),
    record(101, 1500, 45),
    record(101, 3000, 75),
  ])
  const [job] = groupReceivables(invoices, 'job')

  assert.equal(job.jobName, '101')
  assert.equal(job.builderName, 'Builder A')
  assert.deepEqual(job.buckets, {
    CURRENT: 0,
    DAYS_1_30: 250000,
    DAYS_31_60: 150000,
    DAYS_61_90: 300000,
    DAYS_91_PLUS: 0,
  })
  assert.equal(job.totalCents, 700000)
  assert.equal(job.invoiceCount, 3)
  assert.equal('daysPastDue' in job, false)
  assert.equal('daysPastDue' in groupReceivables(invoices, 'builder')[0], false)
})

test('a Builder adds the Jobs under it, and a Builder with several Jobs is one row', () => {
  const invoices = build([
    record(101, 2500, 12),
    record(101, 1500, 45),
    record(102, 3000, 75),
    record(103, 2000, 0),
    record(103, 1500, 120),
    record(201, 4000, 95),
  ])
  const builders = groupReceivables(invoices, 'builder')
  const builderA = builders.find((group) => group.builderName === 'Builder A')
  const builderB = builders.find((group) => group.builderName === 'Builder B')

  assert.equal(builders.length, 2)
  assert.deepEqual(builderA.buckets, {
    CURRENT: 200000,
    DAYS_1_30: 250000,
    DAYS_31_60: 150000,
    DAYS_61_90: 300000,
    DAYS_91_PLUS: 150000,
  })
  assert.equal(builderA.totalCents, 1050000)
  assert.equal(builderA.invoiceCount, 5)
  assert.equal(builderB.buckets.DAYS_91_PLUS, 400000)
  assert.equal(builderB.totalCents, 400000)
})

test('Builder, Job and Invoice totals agree for every bucket', () => {
  const invoices = build([
    record(101, 100.1, 0),
    record(101, 200.2, 1),
    record(101, 300.3, 30),
    record(102, 400.4, 31),
    record(102, 500.5, 60),
    record(103, 600.6, 61),
    record(103, 700.7, 90),
    record(201, 800.8, 91),
    record(201, 0.1, 5),
    record(201, 0.2, 5),
  ])
  const all = totalReceivables(invoices)
  const jobs_ = groupReceivables(invoices, 'job')
  const builders = groupReceivables(invoices, 'builder')

  const sum = (groups, key) => groups.reduce((total, group) => total + group.buckets[key], 0)
  for (const key of AGING_BUCKET_KEYS) {
    assert.equal(sum(jobs_, key), all.buckets[key], `Jobs, ${key}`)
    assert.equal(sum(builders, key), all.buckets[key], `Builders, ${key}`)
  }
  assert.equal(jobs_.reduce((total, group) => total + group.totalCents, 0), all.totalCents)
  assert.equal(builders.reduce((total, group) => total + group.totalCents, 0), all.totalCents)
  assert.equal(
    all.totalCents,
    invoices.reduce((total, invoice) => total + invoice.balanceCents, 0),
  )
  assert.equal(all.totalCents, Object.values(all.buckets).reduce((a, b) => a + b, 0))

  // Each Builder is the sum of its own Jobs, bucket by bucket.
  for (const builder of builders) {
    const own = groupReceivables(builder.invoices, 'job')
    for (const key of AGING_BUCKET_KEYS) assert.equal(sum(own, key), builder.buckets[key])
  }
})

test('amounts are added in cents, so decimals never leave a stray cent', () => {
  const [a, b] = build([record(101, 0.1, 0), record(101, 0.2, 0)])
  const total = totalReceivables([a, b])

  assert.equal(total.totalCents, 30)
  assert.equal(total.buckets.CURRENT, 30)
})

test('the amount of an invoice can come as text from the database', () => {
  const [invoice] = build([record(101, '1234.56', 3)])

  assert.equal(invoice.balanceCents, 123456)
})

test('filters by Builder, Job, bucket and text all work on the invoices, so every view agrees', () => {
  const invoices = build([
    record(101, 100, 0),
    record(101, 200, 40),
    record(102, 300, 40),
    record(201, 400, 100, { invoiceNumber: 'INV-ZED' }),
  ])

  assert.equal(filterReceivables(invoices, {}).length, 4)
  assert.equal(filterReceivables(invoices, { builderId: '1' }).length, 3)
  assert.equal(filterReceivables(invoices, { builderId: 1, jobId: '102' }).length, 1)
  assert.equal(filterReceivables(invoices, { bucket: 'DAYS_31_60' }).length, 2)
  assert.equal(filterReceivables(invoices, { builderId: '1', bucket: 'DAYS_31_60' }).length, 2)
  assert.equal(filterReceivables(invoices, { builderId: '2', bucket: 'DAYS_31_60' }).length, 0)
  assert.equal(filterReceivables(invoices, { search: 'zed' })[0].jobName, '201')
  assert.equal(filterReceivables(invoices, { search: 'builder b' }).length, 1)
  assert.equal(filterReceivables(invoices, { search: 'pine' }).length, 0)

  // The invoices behind one amount are exactly the ones that make it.
  const [job101] = groupReceivables(filterReceivables(invoices, { jobId: '101' }), 'job')
  const behind = filterReceivables(invoices, { jobId: '101', bucket: 'DAYS_31_60' })
  assert.equal(behind.reduce((total, invoice) => total + invoice.balanceCents, 0), job101.buckets.DAYS_31_60)
})

test('the Builder and Job choices list only what has open invoices, and a Builder narrows its Jobs', () => {
  const invoices = build([record(103, 100, 0), record(101, 100, 0), record(101, 50, 9), record(201, 10, 0)])

  assert.deepEqual(receivableBuilderOptions(invoices), [
    { id: '1', name: 'Builder A' },
    { id: '2', name: 'Builder B' },
  ])
  assert.deepEqual(receivableJobOptions(invoices).map(({ name }) => name), ['101', '103', '201'])
  assert.deepEqual(receivableJobOptions(invoices, '1').map(({ name }) => name), ['101', '103'])
})

test('a Job or Builder missing from the list is shown by its id instead of vanishing', () => {
  const [invoice] = buildReceivableInvoices(
    [{ ...record(101, 100, 0), jobId: 999, builderId: 77 }],
    { reportDate: REPORT_DATE, jobs },
  )

  assert.equal(invoice.jobName, 'Job 999')
  assert.equal(invoice.builderName, 'Builder 77')
})

test('invoices sort most overdue first, the larger balance first among equals, and by any column', () => {
  const invoices = build([
    record(101, 100, 10),
    record(101, 500, 100),
    record(102, 900, 100),
    record(201, 50, 0),
  ])

  assert.deepEqual(
    sortReceivableInvoices(invoices).map((invoice) => [invoice.daysPastDue, invoice.balanceCents]),
    [[100, 90000], [100, 50000], [10, 10000], [0, 5000]],
  )
  assert.deepEqual(
    sortReceivableInvoices(invoices, { key: 'balance', direction: 'asc' }).map((invoice) => invoice.balanceCents),
    [5000, 10000, 50000, 90000],
  )
  assert.deepEqual(
    sortReceivableInvoices(invoices, { key: 'builder', direction: 'desc' })[0].builderName,
    'Builder B',
  )
})

test('Builders and Jobs sort by name, by total or by the amount in one bucket', () => {
  const groups = groupReceivables(build([
    record(101, 100, 0),
    record(102, 900, 40),
    record(103, 500, 100),
    record(201, 500, 0),
  ]), 'job')

  assert.deepEqual(sortReceivableGroups(groups).map((group) => group.jobName), ['102', '103', '201', '101'])
  assert.deepEqual(
    sortReceivableGroups(groups, { key: 'DAYS_31_60', direction: 'desc' })[0].jobName,
    '102',
  )
  assert.deepEqual(
    sortReceivableGroups(groups, { key: 'name', direction: 'asc' }).map((group) => group.jobName),
    ['101', '102', '103', '201'],
  )
})

test('the report date is today in California, whatever the browser clock says', () => {
  assert.equal(californiaDateKey(new Date('2026-10-28T03:00:00Z')), '2026-10-27')
  assert.equal(californiaDateKey(new Date('2026-10-28T08:00:00Z')), '2026-10-28')
  assert.equal(californiaDateKey(new Date('2026-12-01T07:59:00Z')), '2026-11-30')
  assert.equal(californiaDateKey(new Date('2026-12-01T08:00:00Z')), '2026-12-01')
})

test('a report date can be today or later, never an earlier day or a day that does not exist', () => {
  assert.equal(isReportDateAllowed('2026-10-28', '2026-10-28'), true)
  assert.equal(isReportDateAllowed('2026-10-29', '2026-10-28'), true)
  assert.equal(isReportDateAllowed('2027-01-01', '2026-10-28'), true)
  assert.equal(isReportDateAllowed('2026-10-27', '2026-10-28'), false)
  assert.equal(isReportDateAllowed('2026-02-30', '2026-01-01'), false)
  assert.equal(isReportDateAllowed('', '2026-10-28'), false)
  assert.equal(isReportDateAllowed(null, '2026-10-28'), false)
})

test('invoices move to older buckets as the report date moves on', () => {
  const records = [record(101, 100, -10)]
  const bucketOn = (reportDate) => build(records, reportDate)[0].bucket

  assert.equal(bucketOn('2026-12-01'), 'CURRENT')
  assert.equal(bucketOn('2026-12-11'), 'CURRENT')
  assert.equal(bucketOn('2026-12-12'), 'DAYS_1_30')
  assert.equal(bucketOn('2027-01-10'), 'DAYS_1_30')
  assert.equal(bucketOn('2027-01-11'), 'DAYS_31_60')
  assert.equal(bucketOn('2027-03-12'), 'DAYS_91_PLUS')
})

test('the oldest balance check is the one to trust, and none is reported as none', () => {
  const invoices = build([
    record(101, 100, 0, { checkedAt: '2026-12-01T17:30:00+00:00' }),
    record(101, 100, 0, { checkedAt: '2026-12-01T16:00:00+00:00' }),
    record(101, 100, 0, { checkedAt: null }),
  ])

  assert.equal(oldestPaymentCheck(invoices), '2026-12-01T16:00:00+00:00')
  assert.equal(oldestPaymentCheck([]), null)
})

test('an invoice opens the page of its own Package, in its Job and Phase', () => {
  const [invoice] = build([{ ...record(201, 100, 0), packageId: 112, phaseId: 5 }])

  assert.equal(invoicePath(invoice), '/draw-invoice/builder/2/job/201/phase/5/package/112')
})

test('a Package of several Phases has no Phase of its own, so it opens through the first Phase of its Job', () => {
  const withPhases = [
    { id: 101, code: '101', builder: 'Builder A', sequenceSheet: { phases: [{ id: 7 }, { id: 8 }] } },
    { id: 102, code: '102', builder: 'Builder A', sequenceSheet: { phases: [] } },
  ]
  const open = (overrides) => buildReceivableInvoices(
    [{ ...record(101, 100, 0), packageId: 94, ...overrides }],
    { reportDate: REPORT_DATE, jobs: withPhases },
  )[0]

  // Without a Phase the path would stop at the Job and show its Draw worksheet, not the Package.
  assert.equal(invoicePath(open({ phaseId: null })), '/draw-invoice/builder/1/job/101/phase/7/package/94')
  assert.equal(invoicePath(open({ phaseId: undefined })), '/draw-invoice/builder/1/job/101/phase/7/package/94')
  // A Package that has its own Phase keeps it.
  assert.equal(invoicePath(open({ phaseId: 8 })), '/draw-invoice/builder/1/job/101/phase/8/package/94')
  // No Phase to borrow (the Job is not in the list, or has none): nothing is invented.
  assert.equal(open({ phaseId: null, jobId: 102 }).phaseId, null)
  assert.equal(open({ phaseId: null, jobId: 999 }).phaseId, null)
})

test('a Package row and its QuickBooks reading become a receivable record', () => {
  const row = {
    id: 94,
    package_number: 'DP-00000094',
    package_type: 'DRAW',
    builder_id: 1,
    job_id: 1,
    phase_id: 3,
    workflow_status: 'AWAITING_PAYMENT',
    quickbooks_reference: '14863',
    quickbooks_invoice_syncs: {
      qbo_doc_number: '14863',
      qbo_invoice_date: '2026-10-27',
      qbo_due_date: '2026-11-26',
      qbo_total: '89113.95',
      total_amount: '89113.95',
      qbo_balance: '50000.00',
      qbo_state: 'PARTIALLY_PAID',
      qbo_state_checked_at: '2026-10-28 17:17:22+00',
    },
  }

  assert.deepEqual(toReceivableRecord(row), {
    packageId: 94,
    packageNumber: 'DP-00000094',
    packageType: 'DRAW',
    builderId: 1,
    jobId: 1,
    phaseId: 3,
    workflowStatus: 'AWAITING_PAYMENT',
    invoiceNumber: '14863',
    invoiceDate: '2026-10-27',
    dueDate: '2026-11-26',
    originalAmount: 89113.95,
    balance: 50000,
    paymentState: 'PARTIALLY_PAID',
    checkedAt: '2026-10-28 17:17:22+00',
  })
})

test('before QuickBooks reports a total the amount sent is the original, and missing fields stay empty', () => {
  const record_ = toReceivableRecord({
    id: 1,
    package_number: 'DP-00000001',
    quickbooks_reference: 'REF-1',
    quickbooks_invoice_syncs: { total_amount: '10.50', qbo_balance: null },
  })

  assert.equal(record_.originalAmount, 10.5)
  assert.equal(record_.balance, null)
  assert.equal(record_.invoiceNumber, 'REF-1')
  assert.equal(record_.invoiceDate, null)
  assert.equal(record_.dueDate, null)
  assert.equal(isNaN(record_.originalAmount), false)
})
