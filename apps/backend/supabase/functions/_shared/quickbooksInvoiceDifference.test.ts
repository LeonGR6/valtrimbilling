import { assertEquals } from '@std/assert'
import {
  cleanDifferenceDescription,
  differenceLimit,
  differenceProblem,
  readInvoiceDifference,
} from './quickbooksInvoiceDifference.ts'

Deno.test('the limit is $5 for every $5,000 of invoice, counted from the first dollar', () => {
  assertEquals(differenceLimit(0), 5)
  assertEquals(differenceLimit(0.01), 5)
  assertEquals(differenceLimit(2500), 5)
  assertEquals(differenceLimit(5000), 5)
  assertEquals(differenceLimit(5000.01), 10)
  assertEquals(differenceLimit(6700), 10)
  assertEquals(differenceLimit(10000), 10)
  assertEquals(differenceLimit(10000.01), 15)
  assertEquals(differenceLimit(14999.99), 15)
  assertEquals(differenceLimit(15000.01), 20)
  assertEquals(differenceLimit(52000), 55)
})

Deno.test('a negative net is measured as zero', () => {
  assertEquals(differenceLimit(-300), 5)
})

Deno.test('$8 is fine on an invoice of $6,700 and $15 is too much', () => {
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 8 }, 6700), null)
  const tooMuch = differenceProblem({ description: 'DIFFERENCE', amount: 15 }, 6700)
  assertEquals(tooMuch?.code, 'TOO_LARGE')
  assertEquals(
    tooMuch?.message,
    'The difference of $15.00 is greater than the $10.00 allowed for an invoice of $6,700.00.',
  )
})

Deno.test('the limit is the same in both directions and the edge is allowed', () => {
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 10 }, 6700), null)
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: -10 }, 6700), null)
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 10.01 }, 6700)?.code, 'TOO_LARGE')
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: -10.01 }, 6700)?.code, 'TOO_LARGE')
  // The message names the size of the difference, not its sign.
  assertEquals(
    differenceProblem({ description: 'DIFFERENCE', amount: -15 }, 6700)?.message,
    'The difference of $15.00 is greater than the $10.00 allowed for an invoice of $6,700.00.',
  )
})

Deno.test('a zero difference, a missing text and more than two decimals are refused', () => {
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 0 }, 6700)?.code, 'INVALID')
  assertEquals(differenceProblem({ description: '   ', amount: 5 }, 6700)?.code, 'INVALID')
  assertEquals(differenceProblem({ description: 'x'.repeat(101), amount: 5 }, 6700)?.code, 'INVALID')
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 5.005 }, 6700)?.code, 'INVALID')
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: Number.NaN }, 6700)?.code, 'INVALID')
})

Deno.test('a difference cannot bring a tiny invoice to zero or below', () => {
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: -3 }, 3)?.code, 'INVALID')
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: -2.99 }, 3), null)
})

Deno.test('reads the difference of a request and cleans its text', () => {
  assertEquals(readInvoiceDifference(undefined), { difference: null, problem: null })
  assertEquals(readInvoiceDifference(null), { difference: null, problem: null })
  assertEquals(
    readInvoiceDifference({ description: '  DIFFERENCE   with  Builder ', amount: 8 }),
    { difference: { description: 'DIFFERENCE with Builder', amount: 8 }, problem: null },
  )
  assertEquals(readInvoiceDifference({ description: 'DIFFERENCE', amount: '8' }).difference, null)
  assertEquals(readInvoiceDifference({ amount: 8 }).difference, null)
  assertEquals(readInvoiceDifference('8').difference, null)
  assertEquals(readInvoiceDifference([8]).difference, null)
  assertEquals(cleanDifferenceDescription('  a \n b  '), 'a b')
})
