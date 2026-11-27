import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAYMENT_CHECK_INTERVAL_MS,
  PAYMENT_CHECK_STORAGE_KEY,
  clearPaymentCheck,
  paymentCheckDue,
  recordPaymentCheck,
} from '../src/features/draw-invoice/utils/paymentCheckThrottle.js'

function fakeStorage() {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

const brokenStorage = {
  getItem() { throw new Error('blocked') },
  setItem() { throw new Error('blocked') },
  removeItem() { throw new Error('blocked') },
}

test('the first opening checks QuickBooks, and a reload within the interval does not', () => {
  const storage = fakeStorage()
  const now = 1_000_000

  assert.equal(paymentCheckDue(now, storage), true)
  recordPaymentCheck(now, storage)
  assert.equal(storage.getItem(PAYMENT_CHECK_STORAGE_KEY), String(now))
  assert.equal(paymentCheckDue(now + 60_000, storage), false)
  assert.equal(paymentCheckDue(now + PAYMENT_CHECK_INTERVAL_MS - 1, storage), false)
})

test('the check is due again once the interval has passed', () => {
  const storage = fakeStorage()
  recordPaymentCheck(1_000_000, storage)

  assert.equal(paymentCheckDue(1_000_000 + PAYMENT_CHECK_INTERVAL_MS, storage), true)
})

test('after a failed check the next opening tries again', () => {
  const storage = fakeStorage()
  recordPaymentCheck(1_000_000, storage)
  clearPaymentCheck(storage)

  assert.equal(paymentCheckDue(1_000_001, storage), true)
})

test('a time in the future (the clock moved back) does not block the check', () => {
  const storage = fakeStorage()
  recordPaymentCheck(5_000_000, storage)

  assert.equal(paymentCheckDue(1_000_000, storage), true)
})

test('without usable storage the last check is still remembered while the page stays open', () => {
  clearPaymentCheck(brokenStorage)
  assert.equal(paymentCheckDue(2_000_000, brokenStorage), true)

  recordPaymentCheck(2_000_000, brokenStorage)
  assert.equal(paymentCheckDue(2_000_000 + 1000, brokenStorage), false)

  clearPaymentCheck(brokenStorage)
  assert.equal(paymentCheckDue(2_000_000 + 1000, brokenStorage), true)
})

test('the screen asks at most every 15 minutes, half the scheduler period of 30 minutes', () => {
  assert.equal(PAYMENT_CHECK_INTERVAL_MS, 15 * 60 * 1000)
})
