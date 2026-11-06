import assert from 'node:assert/strict'
import test from 'node:test'
import { getJobPricingStatus } from '../src/features/plan-pricing/utils/jobPricingStatus.js'

const job = (plans) => ({ sequenceSheet: { plans } })

test('a Job counts the prices of its Plans and Options', () => {
  const status = getJobPricingStatus(job([
    {
      price: 1000,
      options: [
        { price: 300 },
        { price: -120.5 },
        { price: 0, priceNotApplicable: true },
        { price: null },
      ],
    },
    { price: null, options: [{ price: 450 }] },
  ]))

  assert.equal(status.planCount, 2)
  assert.equal(status.optionCount, 5)
  assert.equal(status.total, 7)
  assert.equal(status.priced, 5)
  assert.equal(status.missing, 2)
  assert.equal(status.percent, 71)
  assert.equal(status.complete, false)
})

test('a Job with every price set is complete', () => {
  const status = getJobPricingStatus(job([{ price: 10, options: [{ price: 0 }] }]))

  assert.equal(status.missing, 0)
  assert.equal(status.percent, 100)
  assert.equal(status.complete, true)
})

test('a Job without Plans has nothing to price and is not complete', () => {
  assert.deepEqual(
    [getJobPricingStatus(job([])).total, getJobPricingStatus(job([])).complete],
    [0, false],
  )
  assert.equal(getJobPricingStatus({}).total, 0)
  assert.equal(getJobPricingStatus(null).complete, false)
})
