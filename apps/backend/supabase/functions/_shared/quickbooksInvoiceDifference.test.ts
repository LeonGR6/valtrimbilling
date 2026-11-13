import { assertEquals } from '@std/assert'
import {
  cleanDifferenceDescription,
  differenceLimit,
  differenceProblem,
  differenceReasonProblem,
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

Deno.test('$8 more is fine on an invoice of $6,700 and $15 less is too much', () => {
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 8 }, 6700), null)
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: -8 }, 6700), null)
  const tooMuch = differenceProblem({ description: 'DIFFERENCE', amount: -15 }, 6700)
  assertEquals(tooMuch?.code, 'TOO_LARGE')
  assertEquals(
    tooMuch?.message,
    'The difference of $15.00 is greater than the $10.00 allowed for an invoice of $6,700.00.',
  )
})

Deno.test('the limit only holds a line that takes off: one that adds money has none', () => {
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: -10 }, 6700), null)
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: -10.01 }, 6700)?.code, 'TOO_LARGE')
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 10.01 }, 6700), null)
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 250 }, 6700), null)
  assertEquals(differenceProblem({ description: 'DIFFERENCE', amount: 123456.78 }, 6700), null)
})

Deno.test('a line that adds money needs a reason, one that takes off does not', () => {
  assertEquals(differenceReasonProblem({ description: 'DIFFERENCE', amount: -3 }), null)
  assertEquals(differenceReasonProblem({ description: 'DIFFERENCE', amount: 3, reason: 'Builder PO has the old price' }), null)
  for (const reason of [undefined, null, '', '   ']) {
    assertEquals(
      differenceReasonProblem({ description: 'DIFFERENCE', amount: 3, reason }),
      'The Builder pays more than the Package: write the reason for the difference.',
    )
  }
  assertEquals(
    differenceReasonProblem({ description: 'DIFFERENCE', amount: 3, reason: 'x'.repeat(501) }),
    'The reason can have up to 500 characters.',
  )
  assertEquals(differenceReasonProblem({ description: 'DIFFERENCE', amount: 3, reason: 'x'.repeat(500) }), null)
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
    readInvoiceDifference({ description: '  DIFFERENCE   with  Builder ', amount: -8 }),
    { difference: { description: 'DIFFERENCE with Builder', amount: -8, reason: null }, problem: null },
  )
  assertEquals(readInvoiceDifference({ description: 'DIFFERENCE', amount: '8' }).difference, null)
  assertEquals(readInvoiceDifference({ amount: 8 }).difference, null)
  assertEquals(readInvoiceDifference('8').difference, null)
  assertEquals(readInvoiceDifference([8]).difference, null)
  assertEquals(cleanDifferenceDescription('  a \n b  '), 'a b')
})

Deno.test('a request that adds money must come with its reason, which is cleaned; for one that takes off it is dropped', () => {
  assertEquals(
    readInvoiceDifference({ description: 'DIFFERENCE', amount: 8, reason: '  Builder  PO\n is higher ' }),
    { difference: { description: 'DIFFERENCE', amount: 8, reason: 'Builder PO is higher' }, problem: null },
  )
  assertEquals(
    readInvoiceDifference({ description: 'DIFFERENCE', amount: 8 }),
    { difference: null, problem: 'The Builder pays more than the Package: write the reason for the difference.' },
  )
  assertEquals(readInvoiceDifference({ description: 'DIFFERENCE', amount: 8, reason: '  ' }).difference, null)
  assertEquals(readInvoiceDifference({ description: 'DIFFERENCE', amount: 8, reason: 5 }).problem, 'The reason must be text.')
  assertEquals(
    readInvoiceDifference({ description: 'DIFFERENCE', amount: -8, reason: 'not needed' }).difference,
    { description: 'DIFFERENCE', amount: -8, reason: null },
  )
})
