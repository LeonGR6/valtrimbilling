import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adjustmentIssue,
  differenceComponents,
  formatSignedMoney,
  groupPriceDifferences,
  selectedDifferenceTotals,
  toPriceDifference,
  workflowStatusLabel,
} from '../src/features/plan-pricing/utils/priceDifferences.js'

function row(overrides = {}) {
  return {
    id: 1,
    recalculation_id: 9,
    package_id: 35,
    package_number: 'DP-00000035',
    line_kind: 'DRAW',
    lot_id: 71,
    draw_number: 2,
    hardware_event_type: null,
    phase_code: '1',
    building: 'C5',
    lot_number: '12',
    plan_code: 'A',
    billed_net: '1000.00',
    new_net: '1100.00',
    delta_base: '100.00',
    delta_hardware: '0.00',
    delta_utility: '0.00',
    delta_options: '7.00',
    delta_gross: '107.00',
    delta_retention: '5.35',
    delta_wrap: '2.14',
    delta_net: '99.51',
    created_at: '2026-10-22T12:00:00Z',
    ...overrides,
  }
}

test('a stored difference becomes numbers and a readable label', () => {
  const line = toPriceDifference(row())

  assert.equal(line.label, 'Lot 12 · Draw 2')
  assert.equal(line.phaseLabel, '1 · C5')
  assert.equal(line.gross, 107)
  assert.equal(line.retention, 5.35)
  assert.equal(line.net, 99.51)
  assert.equal(line.packageId, 35)
})

test('a Hardware event line is labelled by its event and has no Draw', () => {
  const line = toPriceDifference(row({
    line_kind: 'HARDWARE_EVENT',
    draw_number: null,
    hardware_event_type: 'EXT',
    building: null,
    delta_hardware: '120.00',
  }))

  assert.equal(line.label, 'Lot 12 · Hardware EXT')
  assert.equal(line.drawNumber, null)
  assert.equal(line.phaseLabel, '1')
  assert.deepEqual(differenceComponents(line), [
    ['Plan price', 100],
    ['Hardware', 120],
    ['Options', 7],
  ])
})

test('only the components that changed are listed, in reading order', () => {
  assert.deepEqual(differenceComponents(toPriceDifference(row())), [
    ['Plan price', 100],
    ['Options', 7],
  ])
  assert.deepEqual(
    differenceComponents(toPriceDifference(row({ delta_base: '0.00', delta_options: '0.00' }))),
    [],
  )
})

test('differences are grouped by Package with totals that add up to the cent', () => {
  const statuses = new Map([[35, 'AWAITING_PAYMENT'], [36, 'PAID_CLOSED']])
  const { packages, totals } = groupPriceDifferences([
    row({ id: 1 }),
    row({ id: 2, draw_number: 3, delta_gross: '0.10', delta_retention: '0.01', delta_wrap: '0.00', delta_net: '0.09' }),
    row({ id: 3, package_id: 36, package_number: 'DP-00000036', delta_gross: '-7.00', delta_retention: '-0.35', delta_wrap: '-0.14', delta_net: '-6.51' }),
  ], statuses)

  assert.equal(packages.length, 2)
  assert.deepEqual(packages.map((item) => [item.packageNumber, item.status, item.totals.lineCount]), [
    ['DP-00000035', 'AWAITING_PAYMENT', 2],
    ['DP-00000036', 'PAID_CLOSED', 1],
  ])
  assert.equal(packages[0].totals.gross, 107.1)
  assert.equal(packages[0].totals.net, 99.6)
  assert.equal(packages[1].totals.net, -6.51)
  assert.deepEqual(totals, { gross: 100.1, retention: 5.01, wrap: 2, net: 93.09, lineCount: 3 })
})

test('with nothing pending the list is empty and the total is zero', () => {
  const { packages, totals } = groupPriceDifferences([])

  assert.deepEqual(packages, [])
  assert.deepEqual(totals, { gross: 0, retention: 0, wrap: 0, net: 0, lineCount: 0 })
})

test('amounts show their sign, so a credit reads as a credit', () => {
  assert.equal(formatSignedMoney(317), '+$317.00')
  assert.equal(formatSignedMoney(-6.51), '-$6.51')
  assert.equal(formatSignedMoney(0), '$0.00')
})

test('the Package status reads as people say it', () => {
  assert.equal(workflowStatusLabel('AWAITING_PAYMENT'), 'Awaiting payment')
  assert.equal(workflowStatusLabel('PAID_CLOSED'), 'Paid')
  assert.equal(workflowStatusLabel('DRAFT'), 'Draft')
  assert.equal(workflowStatusLabel(null), 'Package')
})

test('the chosen Packages add up, credits against charges', () => {
  const { packages } = groupPriceDifferences([
    row({ id: 1, delta_gross: '400.00', delta_retention: '20.00', delta_wrap: '8.00', delta_net: '372.00' }),
    row({ id: 2, package_id: 36, package_number: 'DP-00000036', delta_gross: '-250.00', delta_retention: '-12.50', delta_wrap: '-5.00', delta_net: '-232.50' }),
    row({ id: 3, package_id: 37, package_number: 'DP-00000037', delta_gross: '10.00', delta_retention: '0.50', delta_wrap: '0.20', delta_net: '9.30' }),
  ])

  assert.deepEqual(selectedDifferenceTotals(packages, [35, 36]), {
    gross: 150, retention: 7.5, wrap: 3, net: 139.5, lineCount: 2,
  })
  assert.deepEqual(selectedDifferenceTotals(packages, [37]).net, 9.3)
  assert.deepEqual(selectedDifferenceTotals(packages, []), {
    gross: 0, retention: 0, wrap: 0, net: 0, lineCount: 0,
  })
})

test('only a positive total can be invoiced', () => {
  const ok = { gross: 150, retention: 7.5, wrap: 3, net: 139.5, lineCount: 2 }

  assert.equal(adjustmentIssue(ok), null)
  assert.match(adjustmentIssue({ ...ok, lineCount: 0 }), /at least one Package/)
  assert.match(
    adjustmentIssue({ gross: -100, retention: -5, wrap: -2, net: -93, lineCount: 1 }),
    /add up to a credit/,
  )
  assert.match(
    adjustmentIssue({ gross: 0, retention: 0, wrap: 0, net: 0, lineCount: 1 }),
    /add up to nothing/,
  )
  // A positive net with a negative part cannot be one invoice.
  assert.match(
    adjustmentIssue({ gross: 100, retention: -3, wrap: 1, net: 102, lineCount: 1 }),
    /negative amount/,
  )
})
