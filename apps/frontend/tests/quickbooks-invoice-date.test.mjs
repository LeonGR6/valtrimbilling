import assert from 'node:assert/strict'
import test from 'node:test'
import { quickbooksInvoiceDate } from '../src/features/draw-invoice/services/quickbooksRecord.js'

const today = '2026-10-28'

test('a Draw Package of a Builder with cut off dates is invoiced on its cut off date', () => {
  assert.deepEqual(
    quickbooksInvoiceDate({
      packageType: 'DRAW',
      billingCutoffAnyDate: false,
      billingCutoffDate: '2026-10-30',
    }, today),
    { date: '2026-10-30', source: 'CUTOFF' },
  )
  // A cut off date already past is still the one invoiced.
  assert.equal(
    quickbooksInvoiceDate({ billingCutoffAnyDate: false, billingCutoffDate: '2026-10-15' }, today).date,
    '2026-10-15',
  )
})

test('a Builder that bills any date is invoiced the day the invoice is created', () => {
  assert.deepEqual(
    quickbooksInvoiceDate({
      packageType: 'DRAW',
      billingCutoffAnyDate: true,
      billingCutoffDate: null,
    }, today),
    { date: today, source: 'CREATION' },
  )
  // Even if a date was worked out for it, any date wins.
  assert.equal(
    quickbooksInvoiceDate({ billingCutoffAnyDate: true, billingCutoffDate: '2026-10-30' }, today).date,
    today,
  )
})

test('a setup that gives no cut off date, a Price Adjustment and a missing record use the creation day', () => {
  assert.equal(quickbooksInvoiceDate({ billingCutoffAnyDate: false, billingCutoffDate: null }, today).date, today)
  assert.deepEqual(
    quickbooksInvoiceDate({
      packageType: 'PRICE_ADJUSTMENT',
      billingCutoffAnyDate: false,
      billingCutoffDate: '2026-10-30',
    }, today),
    { date: today, source: 'CREATION' },
  )
  assert.deepEqual(quickbooksInvoiceDate(null, today), { date: today, source: 'CREATION' })
})
