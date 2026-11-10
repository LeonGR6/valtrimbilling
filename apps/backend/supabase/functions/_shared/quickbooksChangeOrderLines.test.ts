import { assertEquals, assertThrows } from '@std/assert'
import { changeOrderInvoiceLines, type ChangeOrderLineRow, formatMoney, lotsText } from './quickbooksChangeOrderLines.ts'
import { buildQuickbooksInvoicePayload, QuickbooksInvoiceError } from './quickbooksInvoice.ts'
import { mapPackageToCharges, type PackageInvoiceSource } from './quickbooksPackageCharges.ts'

let next = 0
const lot = (lotNumber: string, overrides: Partial<ChangeOrderLineRow> = {}): ChangeOrderLineRow => {
  next += 1
  return {
    line_number: next,
    lot_id: 600 + next,
    phase_code: '2',
    building: '2',
    lot_number: lotNumber,
    plan_code: '1',
    location: null,
    scope_of_work: 'Testing',
    amount: '27.00',
    ...overrides,
  }
}
const place = (location: string, scope: string, amount: number): ChangeOrderLineRow => {
  next += 1
  return {
    line_number: next, lot_id: null, phase_code: null, building: null, lot_number: null, plan_code: null,
    location, scope_of_work: scope, amount,
  }
}

Deno.test('one Plan, one Scope and one price: one line with the Lots in ranges and the total as its amount', () => {
  assertEquals(changeOrderInvoiceLines([lot('10'), lot('11'), lot('16', { building: '3' }), lot('17', { building: '3' })]), [
    { description: 'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOTS #10-11, 16-17)', amount: 108 },
  ])
})

Deno.test('a Lot with another price goes on a line of its own, cheaper first', () => {
  assertEquals(changeOrderInvoiceLines([lot('10'), lot('11'), lot('16'), lot('17', { amount: 35 })]), [
    { description: 'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOTS #10-11, 16)', amount: 81 },
    { description: 'PLAN 1 (TESTING) $35.00 PER LOT (PHASE 2 LOT #17)', amount: 35 },
  ])
})

Deno.test('another Scope or another Plan is another line, by Plan then Scope', () => {
  const lines = changeOrderInvoiceLines([
    lot('3', { plan_code: '2', scope_of_work: 'Wider door', amount: 300 }),
    lot('1', { scope_of_work: 'Wider door', amount: 300 }),
    lot('2', { scope_of_work: 'Attic ladder', amount: 120 }),
    lot('4', { plan_code: '10', scope_of_work: 'Wider door', amount: 300 }),
  ])
  assertEquals(lines.map((line) => line.description), [
    'PLAN 1 (ATTIC LADDER) $120.00 PER LOT (PHASE 2 LOT #2)',
    'PLAN 1 (WIDER DOOR) $300.00 PER LOT (PHASE 2 LOT #1)',
    'PLAN 2 (WIDER DOOR) $300.00 PER LOT (PHASE 2 LOT #3)',
    'PLAN 10 (WIDER DOOR) $300.00 PER LOT (PHASE 2 LOT #4)',
  ])
})

Deno.test('the same Scope written with other spaces or capitals is the same work', () => {
  const lines = changeOrderInvoiceLines([lot('1', { scope_of_work: 'Wider  door' }), lot('2', { scope_of_work: 'wider door\n' })])
  assertEquals(lines.length, 1)
  assertEquals(lines[0].description, 'PLAN 1 (WIDER DOOR) $27.00 PER LOT (PHASE 2 LOTS #1-2)')
})

Deno.test('Lots of several Phases are named by Phase, in order, because Lot numbers repeat', () => {
  assertEquals(
    changeOrderInvoiceLines([lot('4', { phase_code: '3' }), lot('10'), lot('11'), lot('5', { phase_code: 'Phase 3' })])[0].description,
    'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOTS #10-11; PHASE 3 LOTS #4-5)',
  )
  assertEquals(lotsText([{ phase: '1', lot: '12' }, { phase: '1', lot: '12.1' }, { phase: '1', lot: '13' }]), 'PHASE 1 LOTS #12, 12.1, 13')
})

Deno.test('lines without a Lot are their place and their Scope, after the Lots, in their order', () => {
  assertEquals(changeOrderInvoiceLines([place('Sales Office', 'Electronic locks', 250.5), lot('10'), place('Restroom', 'Credit', -20)]), [
    { description: 'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOT #10)', amount: 27 },
    { description: 'SALES OFFICE (ELECTRONIC LOCKS)', amount: 250.5 },
    { description: 'RESTROOM (CREDIT)', amount: -20 },
  ])
})

Deno.test('a credit per Lot is written as a negative price and a negative total', () => {
  assertEquals(changeOrderInvoiceLines([lot('1', { amount: -20 }), lot('2', { amount: -20 })]), [
    { description: 'PLAN 1 (TESTING) -$20.00 PER LOT (PHASE 2 LOTS #1-2)', amount: -40 },
  ])
})

Deno.test('the PO / CO # of the Builder ends every line', () => {
  const lines = changeOrderInvoiceLines([lot('10'), place('Sales Office', 'Locks', 5)], { poCoNumber: ' 9167 ' })
  assertEquals(lines.map((line) => line.description), [
    'PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOT #10) - 9167 CHANGE ORDER',
    'SALES OFFICE (LOCKS) - 9167 CHANGE ORDER',
  ])
})

Deno.test('money has thousands separators and exact cents', () => {
  assertEquals(formatMoney(125000), '$1,250.00')
  assertEquals(formatMoney(-2050), '-$20.50')
  assertEquals(changeOrderInvoiceLines([lot('1', { amount: '0.10' }), lot('2', { amount: '0.10' }), lot('3', { amount: '0.10' })])[0].amount, 0.3)
})

const coSource = (overrides: Partial<PackageInvoiceSource> = {}): PackageInvoiceSource => ({
  package: { package_type: 'CHANGE_ORDER', status: 'DRAFT', invoice_line_format: 'LOT_SCOPE' },
  draws: [],
  hardwareLines: [],
  changeOrder: { poCoNumber: null },
  changeOrderLines: [lot('10'), lot('11'), lot('16'), lot('17'), place('Sales Office', 'Locks', 25)],
  invoice: { net_amount: 133 },
  ...overrides,
})

Deno.test('a Change Order Package becomes its described lines, with no Retention or WRAP, totalling its net', () => {
  const mapped = mapPackageToCharges(coSource())
  assertEquals(mapped.retentionAmount, 0)
  assertEquals(mapped.wrapAmount, 0)
  assertEquals(mapped.expectedNetAmount, 133)

  const payload = buildQuickbooksInvoicePayload({ customerId: '58', itemId: '7', txnDate: '2026-11-10', ...mapped })
  assertEquals(payload.Line.map((line) => [line.Description, line.Amount, line.SalesItemLineDetail.Qty, line.SalesItemLineDetail.UnitPrice]), [
    ['PLAN 1 (TESTING) $27.00 PER LOT (PHASE 2 LOTS #10-11, 16-17)', 108, 1, 108],
    ['SALES OFFICE (LOCKS)', 25, 1, 25],
  ])
})

Deno.test('a Change Order Package whose lines do not add up to its invoice is refused', () => {
  const mapped = mapPackageToCharges(coSource({ invoice: { net_amount: 100 } }))
  assertThrows(
    () => buildQuickbooksInvoicePayload({ customerId: '58', itemId: '7', txnDate: '2026-11-10', ...mapped }),
    QuickbooksInvoiceError,
    'add up to 133.00',
  )
})

Deno.test('a Change Order Package needs its lines and nothing else', () => {
  assertThrows(() => mapPackageToCharges(coSource({ changeOrderLines: [] })), QuickbooksInvoiceError, 'no lines')
  assertThrows(
    () => mapPackageToCharges(coSource({ optionLines: [{ lot_number: '1', phase_code: '1', building: null, option_price: 1 }] })),
    QuickbooksInvoiceError,
    'cannot have',
  )
})
