import assert from 'node:assert/strict'
import test from 'node:test'
import { createHardwarePriceSchema } from '../src/features/plan-pricing/schemas/priceSchema.js'

test('hardware price accepts an amount included in the base plan price', () => {
  const result = createHardwarePriceSchema(3000).parse({ amount: '1000.00' })

  assert.deepEqual(result, { amount: 1000 })
})

test('hardware price cannot exceed the base plan price', () => {
  const result = createHardwarePriceSchema(3000).safeParse({ amount: '3000.01' })

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.amount)
})
