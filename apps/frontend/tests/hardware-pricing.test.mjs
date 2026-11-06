import assert from 'node:assert/strict'
import test from 'node:test'
import { createHardwarePriceSchema } from '../src/features/plan-pricing/schemas/priceSchema.js'

test('hardware price accepts an amount additional to the Plan price', () => {
  const result = createHardwarePriceSchema(3000).parse({ amount: '1000.00' })

  assert.deepEqual(result, { amount: 1000 })
})

test('hardware price can exceed the Plan price because it is additional', () => {
  const result = createHardwarePriceSchema(3000).parse({ amount: '3000.01' })

  assert.deepEqual(result, { amount: 3000.01 })
})
