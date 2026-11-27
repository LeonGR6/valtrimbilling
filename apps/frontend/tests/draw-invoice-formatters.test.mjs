import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPercentage } from '../src/features/draw-invoice/utils/drawInvoiceFormatters.js'

test('percentages keep up to three decimals and drop trailing zeros', () => {
  assert.equal(formatPercentage(5), '5')
  assert.equal(formatPercentage(8.33), '8.33')
  assert.equal(formatPercentage(2.5), '2.5')
  assert.equal(formatPercentage(0.833), '0.833')
  assert.equal(formatPercentage(0.001), '0.001')
  assert.equal(formatPercentage('0.125'), '0.125')
  assert.equal(formatPercentage(null), '0')
})
