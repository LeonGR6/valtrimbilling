import assert from 'node:assert/strict'
import test from 'node:test'
import { optionPricingSummary } from '../src/features/plan-pricing/utils/optionPricing.js'

const option = (price, extra = {}) => ({ price, ...extra })

test('a Plan with unpriced options says how many are missing', () => {
  const summary = optionPricingSummary([option(100), option(null), option(undefined), option(0, { priceNotApplicable: true })])

  assert.equal(summary.total, 4)
  assert.equal(summary.priced, 2)
  assert.equal(summary.missing, 2)
  assert.equal(summary.complete, false)
  assert.equal(summary.label, '2 of 4 options priced')
})

test('NA, a credit and a $0 price all count as priced', () => {
  const summary = optionPricingSummary([option(0, { priceNotApplicable: true }), option(-25.5), option(0)])

  assert.equal(summary.missing, 0)
  assert.equal(summary.complete, true)
  assert.equal(summary.label, '3 of 3 options priced')
})

test('a Plan without options has nothing missing', () => {
  assert.deepEqual(optionPricingSummary([]), {
    priced: 0, missing: 0, total: 0, complete: true, label: 'No options',
  })
  assert.equal(optionPricingSummary().complete, true)
  assert.equal(optionPricingSummary([option(5)]).label, '1 of 1 option priced')
  assert.equal(optionPricingSummary([option(Number.NaN)]).missing, 1)
})
