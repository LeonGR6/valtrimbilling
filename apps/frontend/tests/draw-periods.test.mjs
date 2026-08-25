import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeDrawPeriods,
  describeSchedule,
} from '../src/features/builder-draw-schedules/utils/drawPeriods.js'

// Reference point: Aug 1 2026, so every expectation below is deterministic.
const from = new Date(2026, 7, 1)

const monthly = {
  frequency: 'MONTHLY',
  cutoffDay: 20,
  submissionDay: 25,
  invoiceDateRule: 'SUBMISSION',
  paymentTermsDays: 30,
}

test('monthly rule cuts off and submits on the configured days', () => {
  const [first] = computeDrawPeriods(monthly, 2, from)

  assert.equal(first.cutoffDate.getMonth(), 7)
  assert.equal(first.cutoffDate.getDate(), 20)
  assert.equal(first.submissionDate.getDate(), 25)
  assert.equal(first.invoiceDate.getDate(), 25)
})

test('monthly rule advances one month per period', () => {
  const [first, second] = computeDrawPeriods(monthly, 2, from)

  assert.equal(first.cutoffDate.getMonth(), 7)
  assert.equal(second.cutoffDate.getMonth(), 8)
})

test('estimated payment adds the payment terms to the invoice date', () => {
  const [first] = computeDrawPeriods(monthly, 1, from)
  const days =
    (first.estimatedPaymentDate - first.invoiceDate) / 86400000

  assert.equal(Math.round(days), 30)
})

test('a submission day before the cutoff lands the next month', () => {
  const [first] = computeDrawPeriods(
    { ...monthly, cutoffDay: 25, submissionDay: 5 },
    1,
    from,
  )

  assert.equal(first.cutoffDate.getMonth(), 7)
  assert.equal(first.submissionDate.getMonth(), 8)
})

test('cutoff day 31 clamps to the last day of a short month', () => {
  // September has 30 days.
  const [first] = computeDrawPeriods(
    { ...monthly, cutoffDay: 31 },
    1,
    new Date(2026, 8, 1),
  )

  assert.equal(first.cutoffDate.getDate(), 30)
})

test('weekly rule always cuts off on the configured weekday', () => {
  const periods = computeDrawPeriods(
    {
      frequency: 'WEEKLY',
      cutoffWeekday: 0,
      submissionOffsetDays: 2,
      invoiceDateRule: 'SUBMISSION',
      paymentTermsDays: 21,
    },
    3,
    from,
  )

  for (const period of periods) {
    assert.equal(period.cutoffDate.getDay(), 0)
    assert.equal(period.submissionDate.getDay(), 2)
  }
})

test('weekly periods are seven days apart', () => {
  const [first, second] = computeDrawPeriods(
    { frequency: 'WEEKLY', cutoffWeekday: 0, submissionOffsetDays: 2, paymentTermsDays: 0 },
    2,
    from,
  )
  const days = (second.cutoffDate - first.cutoffDate) / 86400000

  assert.equal(Math.round(days), 7)
})

test('twice a month alternates between both cutoff days', () => {
  const periods = computeDrawPeriods(
    {
      frequency: 'SEMIMONTHLY',
      cutoffDays: [10, 25],
      submissionOffsetDays: 3,
      invoiceDateRule: 'CUTOFF',
      paymentTermsDays: 45,
    },
    4,
    from,
  )

  assert.deepEqual(
    periods.map((period) => period.cutoffDate.getDate()),
    [10, 25, 10, 25],
  )
  assert.deepEqual(
    periods.map((period) => period.cutoffDate.getMonth()),
    [7, 7, 8, 8],
  )
})

test('an unknown frequency produces no periods instead of throwing', () => {
  assert.deepEqual(computeDrawPeriods({ frequency: 'CUSTOM' }, 3, from), [])
  assert.deepEqual(computeDrawPeriods(null, 3, from), [])
})

test('describeSchedule summarizes each frequency in one line', () => {
  assert.match(describeSchedule(monthly), /day 20/)
  assert.match(
    describeSchedule({ frequency: 'WEEKLY', cutoffWeekday: 0, submissionOffsetDays: 2 }),
    /Sunday/,
  )
  assert.match(
    describeSchedule({ frequency: 'SEMIMONTHLY', cutoffDays: [10, 25], submissionOffsetDays: 3 }),
    /10 and 25/,
  )
})
