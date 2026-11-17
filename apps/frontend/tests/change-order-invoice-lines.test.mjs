// The same cases as the Deno tests of backend/supabase/functions/_shared/quickbooksChangeOrderLines.ts:
// the preview on the Extra / CO page must say what the invoice will say.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  changeOrderInvoiceLines,
  formatInvoiceLotRanges,
  formatInvoiceMoney,
  invoiceIsByPlan,
  invoiceLinesTotal,
  invoiceLotsText,
} from '../src/features/change-orders/utils/invoiceLines.js'

let next = 0
const lot = (lotNumber, overrides = {}) => {
  next += 1
  return { lineNumber: next, isPlace: false, lotId: 600 + next, phase: '2', building: '2', lot: lotNumber, plan: '1', location: '', scope: 'Testing', amount: 27, ...overrides }
}
const place = (location, scope, amount) => {
  next += 1
  return { lineNumber: next, isPlace: true, lotId: null, phase: '', building: '', lot: '', plan: '', location, scope, amount }
}

test('one Plan, one Scope and one price: one line with the Lots in ranges and the total as its amount', () => {
  assert.deepEqual(changeOrderInvoiceLines([lot('10'), lot('11'), lot('16', { building: '3' }), lot('17', { building: '3' })]), [
    { description: 'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOTS #10-11, 16-17)', amount: 108 },
  ])
})

test('a Lot with another price goes on a line of its own, cheaper first', () => {
  assert.deepEqual(changeOrderInvoiceLines([lot('10'), lot('11'), lot('16'), lot('17', { amount: 35 })]), [
    { description: 'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOTS #10-11, 16)', amount: 81 },
    { description: 'PLAN 1 (TESTING) $35.00 PER LOT (PHASE 2 LOT #17)', amount: 35 },
  ])
})

test('another Scope or another Plan is another line, by Plan then Scope', () => {
  const lines = changeOrderInvoiceLines([
    lot('3', { plan: '2', scope: 'Wider door', amount: 300 }),
    lot('1', { scope: 'Wider door', amount: 300 }),
    lot('2', { scope: 'Attic ladder', amount: 120 }),
    lot('4', { plan: '10', scope: 'Wider door', amount: 300 }),
  ])
  assert.deepEqual(lines.map((line) => line.description), [
    'PLAN 1 (ATTIC LADDER) $120.00 PER LOT (PHASE 2 LOT #2)',
    'PLAN 1 (WIDER DOOR) $300.00 PER LOT (PHASE 2 LOT #1)',
    'PLAN 2 (WIDER DOOR) $300.00 PER LOT (PHASE 2 LOT #3)',
    'PLAN 10 (WIDER DOOR) $300.00 PER LOT (PHASE 2 LOT #4)',
  ])
})

test('the same Scope written with other spaces or capitals is the same work', () => {
  const lines = changeOrderInvoiceLines([lot('1', { scope: 'Wider  door' }), lot('2', { scope: 'wider door\n' })])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].description, 'PLAN 1 (WIDER DOOR) $27.00 PER LOT (PHASE 2 LOTS #1-2)')
})

test('Lots of several Phases are named by Phase, in order, because Lot numbers repeat', () => {
  assert.equal(
    changeOrderInvoiceLines([lot('4', { phase: '3' }), lot('10'), lot('11'), lot('5', { phase: 'Phase 3' })])[0].description,
    'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOTS #10-11; PHASE 3 LOTS #4-5)',
  )
  assert.equal(invoiceLotsText([{ phase: '1', lot: '12' }, { phase: '1', lot: '12.1' }, { phase: '1', lot: '13' }]), 'PHASE 1 LOTS #12, 12.1, 13')
  assert.equal(formatInvoiceLotRanges(['97', '98', '99', '102', '12A', '06']), '6, 97-99, 102, 12A')
})

test('lines without a Lot are their place and their Scope, after the Lots, in their order', () => {
  assert.deepEqual(changeOrderInvoiceLines([place('Sales Office', 'Electronic locks', 250.5), lot('10'), place('Restroom', 'Credit', -20)]), [
    { description: 'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOT #10)', amount: 27 },
    { description: 'SALES OFFICE (ELECTRONIC LOCKS)', amount: 250.5 },
    { description: 'RESTROOM (CREDIT)', amount: -20 },
  ])
})

test('a credit per Lot is written as a negative price and a negative total', () => {
  assert.deepEqual(changeOrderInvoiceLines([lot('1', { amount: -20 }), lot('2', { amount: -20 })]), [
    { description: 'PLAN 1 (TESTING) -$20.00 PER LOT (PHASE 2 LOTS #1-2)', amount: -40 },
  ])
})

test('the PO / CO # of the Builder ends every line', () => {
  const lines = changeOrderInvoiceLines([lot('10'), place('Sales Office', 'Locks', 5)], { poCoNumber: ' 9167 ' })
  assert.deepEqual(lines.map((line) => line.description), [
    'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOT #10) - 9167 CHANGE ORDER',
    'SALES OFFICE (LOCKS) - 9167 CHANGE ORDER',
  ])
})

test('money has thousands separators and exact cents, and the total is exact', () => {
  assert.equal(formatInvoiceMoney(125000), '$1,250.00')
  assert.equal(formatInvoiceMoney(-2050), '-$20.50')
  const lines = changeOrderInvoiceLines([lot('1', { amount: 0.1 }), lot('2', { amount: 0.1 }), lot('3', { amount: 0.1 })])
  assert.equal(lines[0].amount, 0.3)
  assert.equal(invoiceLinesTotal([...lines, { amount: 0.2 }]), 0.5)
})

test('an Extra / CO not about Plans names the work alone, and Lots of any Plan go together', () => {
  const lines = changeOrderInvoiceLines([
    lot('7', { phase: '1', plan: '1A', scope: 'Replace door trim', amount: 498.29 }),
    lot('8', { phase: '1', plan: '2B', scope: 'Replace door trim', amount: 498.29 }),
    place('Sales Office', 'Locks', 5),
  ], { byPlan: false, poCoNumber: '9167' })
  assert.deepEqual(lines, [
    { description: 'REPLACE DOOR TRIM $498.29 PER LOT (PHASE 1 LOTS #7-8) - 9167 CHANGE ORDER', amount: 996.58 },
    { description: 'SALES OFFICE (LOCKS) - 9167 CHANGE ORDER', amount: 5 },
  ])
})

test('the Plan belongs on the invoice only for Specific plan types or one made from a Package', () => {
  assert.equal(invoiceIsByPlan({ coverage: { mode: 'plans' } }), true)
  assert.equal(invoiceIsByPlan({ coverage: {}, fromPackage: true }), true)
  assert.equal(invoiceIsByPlan({ coverage: { mode: 'lots' }, fromPackage: false }), false)
  assert.equal(invoiceIsByPlan({ coverage: null }), false)
})
