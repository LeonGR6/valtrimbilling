import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanDifferenceDescription,
  differenceLimit,
  differenceProblem,
  formatSignedCurrency,
  parseDifferenceAmount,
  readDifferenceDraft,
} from '../src/features/draw-invoice/utils/invoiceDifference.js'

// The same table the server tests (quickbooksInvoiceDifference.test.ts) and the database check use.
test('the limit is $5 for every $5,000 of invoice, counted from the first dollar', () => {
  const table = [
    [0, 5], [0.01, 5], [2500, 5], [5000, 5], [5000.01, 10], [6700, 10], [10000, 10],
    [10000.01, 15], [14999.99, 15], [15000.01, 20], [52000, 55], [-300, 5], [null, 5], ['abc', 5],
  ]
  for (const [net, limit] of table) assert.equal(differenceLimit(net), limit, `net ${net}`)
})

test('$8 passes on an invoice of $6,700 and $15 is too much, with the message the server gives', () => {
  assert.equal(differenceProblem({ description: 'DIFFERENCE', amount: 8 }, 6700), null)
  assert.equal(
    differenceProblem({ description: 'DIFFERENCE', amount: 15 }, 6700),
    'The difference of $15.00 is greater than the $10.00 allowed for an invoice of $6,700.00.',
  )
})

test('the limit is the same in both directions and its edge is allowed', () => {
  assert.equal(differenceProblem({ description: 'DIFFERENCE', amount: 10 }, 6700), null)
  assert.equal(differenceProblem({ description: 'DIFFERENCE', amount: -10 }, 6700), null)
  assert.match(differenceProblem({ description: 'DIFFERENCE', amount: 10.01 }, 6700), /greater than/u)
  assert.match(differenceProblem({ description: 'DIFFERENCE', amount: -10.01 }, 6700), /greater than/u)
})

test('a zero amount, a missing text and cents beyond two are problems', () => {
  assert.match(differenceProblem({ description: 'DIFFERENCE', amount: 0 }, 6700), /\$0\.00/u)
  assert.match(differenceProblem({ description: '  ', amount: 5 }, 6700), /what the difference is for/u)
  assert.match(differenceProblem({ description: 'x'.repeat(101), amount: 5 }, 6700), /up to 100/u)
  assert.match(differenceProblem({ description: 'DIFFERENCE', amount: 5.005 }, 6700), /two decimals/u)
  assert.match(differenceProblem({ description: 'DIFFERENCE', amount: Number.NaN }, 6700), /must be an amount/u)
})

test('a difference cannot bring a tiny invoice to zero or below', () => {
  assert.match(differenceProblem({ description: 'DIFFERENCE', amount: -3 }, 3), /\$0\.00 or less/u)
  assert.equal(differenceProblem({ description: 'DIFFERENCE', amount: -2.99 }, 3), null)
})

test('the amount box reads signs, dollars and thousands, and tells nothing from nonsense', () => {
  assert.equal(parseDifferenceAmount('8'), 8)
  assert.equal(parseDifferenceAmount(' -8.50 '), -8.5)
  assert.equal(parseDifferenceAmount('+8'), 8)
  assert.equal(parseDifferenceAmount('$1,250.5'), 1250.5)
  assert.equal(parseDifferenceAmount('.5'), 0.5)
  assert.equal(parseDifferenceAmount(''), null)
  assert.equal(parseDifferenceAmount('   '), null)
  assert.equal(parseDifferenceAmount(null), null)
  assert.ok(Number.isNaN(parseDifferenceAmount('abc')))
  assert.ok(Number.isNaN(parseDifferenceAmount('8-')))
  assert.ok(Number.isNaN(parseDifferenceAmount('1.2.3')))
})

test('the draft being typed gives the line to send, the problem, or nothing, and the total', () => {
  const closed = readDifferenceDraft({ open: false, description: 'DIFFERENCE', amountText: '8' }, 6700)
  assert.deepEqual(closed, { difference: null, problem: null, total: 6700 })

  const empty = readDifferenceDraft({ open: true, description: 'DIFFERENCE', amountText: '' }, 6700)
  assert.deepEqual(empty, { difference: null, problem: null, total: 6700 })

  const fine = readDifferenceDraft({ open: true, description: ' DIFFERENCE ', amountText: '8' }, 6700)
  assert.deepEqual(fine, { difference: { description: 'DIFFERENCE', amount: 8 }, problem: null, total: 6708 })

  const credit = readDifferenceDraft({ open: true, description: 'DIFFERENCE', amountText: '-4.25' }, 6700)
  assert.equal(credit.total, 6695.75)

  const tooMuch = readDifferenceDraft({ open: true, description: 'DIFFERENCE', amountText: '15' }, 6700)
  assert.equal(tooMuch.difference, null)
  assert.equal(tooMuch.total, 6700)
  assert.match(tooMuch.problem, /greater than the \$10\.00 allowed/u)

  const nonsense = readDifferenceDraft({ open: true, description: 'DIFFERENCE', amountText: 'abc' }, 6700)
  assert.equal(nonsense.difference, null)
  assert.equal(nonsense.problem, 'The difference must be an amount.')
})

test('the limit the server reported is the one used', () => {
  // The server said $20 (it measured a larger invoice): 15 is then fine.
  const draft = readDifferenceDraft({ open: true, description: 'DIFFERENCE', amountText: '15' }, 6700, 20)
  assert.equal(draft.problem, null)
  assert.equal(draft.difference.amount, 15)
})

test('text and signed amounts are written the same everywhere', () => {
  assert.equal(cleanDifferenceDescription('  DIFFERENCE   with \n Builder '), 'DIFFERENCE with Builder')
  assert.equal(formatSignedCurrency(8), '+$8.00')
  assert.equal(formatSignedCurrency(-8.5), '-$8.50')
  assert.equal(formatSignedCurrency(null), '—')
})
