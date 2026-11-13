import assert from 'node:assert/strict'
import test from 'node:test'
import { compareOptionCodes, sortOptionsByCode } from '../src/utils/optionOrder.js'
import { toJobPlan, toPlanOption } from '../src/features/jobs/services/jobPlanRecord.js'
import { groupOptionChanges, toPhasePriceChanges } from '../src/features/plan-pricing/utils/phasePriceChanges.js'
import { sortLinesByLotAndOption, uncoveredByLot } from '../src/features/purchase-orders/services/purchaseOrderRecord.js'
import { toDrawInvoicePackage } from '../src/features/draw-invoice/services/drawInvoicePackageRecord.js'

const codes = (items, key = 'code') => items.map((item) => item[key])

test('codes are ordered A to Z, ignoring case, with digits before letters', () => {
  const shuffled = ['BB140', 'bb110', '2FIN7001', 'BA230', '1STR1000', 'BB1102', 'C9005A']

  assert.deepEqual(
    [...shuffled].sort(compareOptionCodes),
    ['1STR1000', '2FIN7001', 'BA230', 'bb110', 'BB1102', 'BB140', 'C9005A'],
  )
  assert.equal(compareOptionCodes('bb110', 'BB110'), 0)
  assert.equal(compareOptionCodes(null, 'A1') < 0, true)
})

test('sorting options returns a new list and keeps the order of equal codes', () => {
  const options = [
    { id: 1, code: 'B' },
    { id: 2, code: 'A' },
    { id: 3, code: 'a' },
  ]
  const sorted = sortOptionsByCode(options)

  assert.deepEqual(codes(sorted, 'id'), [2, 3, 1])
  assert.deepEqual(codes(options, 'id'), [1, 2, 3])
  assert.deepEqual(
    codes(sortOptionsByCode([{ id: 1, optionCode: 'Z' }, { id: 2, optionCode: 'M' }], (line) => line.optionCode), 'id'),
    [2, 1],
  )
  assert.deepEqual(sortOptionsByCode(), [])
})

test('the Options of a Plan come in code order, however they were created', () => {
  const rows = ['BB414', 'BB110', '1STR1000', 'BA230'].map((code, index) => ({
    id: index + 1,
    plan_id: 9,
    code,
    description: code,
    is_active: true,
  }))
  const plan = toJobPlan(
    { id: 9, job_id: 1, code: '2A', name: '2A', is_active: true },
    null,
    rows.map((row) => toPlanOption(row)),
  )

  assert.deepEqual(codes(plan.options), ['1STR1000', 'BA230', 'BB110', 'BB414'])
})

test('the Options without a Purchase Order are listed by code within each Lot', () => {
  const option = (lotId, optionCode) => ({ lotId, lotNumber: String(lotId), optionCode, optionId: optionCode })
  const lots = uncoveredByLot(
    [option(2, '2WRD0001'), option(1, 'BB414'), option(2, '1STR1000'), option(1, 'BB110')],
    [1, 2],
  )

  assert.deepEqual(lots.map((lot) => lot.lotNumber), ['1', '2'])
  assert.deepEqual(codes(lots[0].options, 'optionCode'), ['BB110', 'BB414'])
  assert.deepEqual(codes(lots[1].options, 'optionCode'), ['1STR1000', '2WRD0001'])
})

test('the lines to import go Lot by Lot and by code within each Lot', () => {
  const line = (lotNumber, optionCode) => ({ lotNumber, optionCode })
  const sorted = sortLinesByLotAndOption([
    line('10', 'BB110'),
    line('9', 'BB414'),
    line('9', 'BB110'),
    line(null, 'AA1'),
  ])

  assert.deepEqual(
    sorted.map(({ lotNumber, optionCode }) => `${lotNumber}:${optionCode}`),
    ['null:AA1', '9:BB110', '9:BB414', '10:BB110'],
  )
})

test('the Option prices to update are listed by code', () => {
  const change = (optionId, code) => ({
    option_id: optionId,
    code,
    from_price: '10',
    to_price: '20',
  })
  const [phase] = toPhasePriceChanges([{
    phase_id: 1,
    code: '1',
    lots: [{
      lot_id: 5,
      lot_number: '5',
      plan_id: 1,
      plan_code: '2A',
      option_changes: [change(1, 'BB414'), change(2, 'BA230'), change(3, '1STR1000')],
    }],
  }])

  assert.deepEqual(codes(phase.lots[0].options), ['1STR1000', 'BA230', 'BB414'])

  const grouped = groupOptionChanges({
    lots: [
      { options: [{ ...phase.lots[0].options[2], lotCount: 0 }] },
      { options: [{ ...phase.lots[0].options[0], lotCount: 0 }] },
    ],
  })
  assert.deepEqual(codes(grouped), ['1STR1000', 'BB414'])
})

test('the Options charged in a Package are listed Lot by Lot, and by code within each Lot', () => {
  const optionRow = (lot_id, option_id, option_code) => ({
    lot_id,
    option_id,
    draw_id: 52,
    option_code,
    option_name: option_code,
    option_price: '10',
  })
  const record = toDrawInvoicePackage(
    {
      id: 1,
      package_number: 'DP-00000001',
      package_type: 'DRAW',
      builder_id: 2,
      job_id: 11,
      phase_id: null,
      setup_version_id: 31,
      package_date: '2026-10-20',
      invoice_line_format: 'LOT_SCOPE',
      workflow_status: 'DRAFT',
      status: 'DRAFT',
      created_at: '2026-10-20T12:00:00Z',
      updated_at: '2026-10-20T12:00:00Z',
      status_changed_at: '2026-10-20T12:00:00Z',
    },
    {
      id: 2,
      package_id: 1,
      gross_amount: '40',
      retention_amount: '0',
      wrap_amount: '0',
      net_amount: '40',
      paid_amount: '0',
      status: 'DRAFT',
    },
    [],
    [optionRow(41, 1, 'BB414'), optionRow(40, 2, 'BB500'), optionRow(41, 3, 'BA230'), optionRow(40, 4, 'AA100')],
  )

  assert.deepEqual(
    record.persistedOptionLines.map((line) => `${line.lotId}:${line.optionCode}`),
    ['40:AA100', '40:BB500', '41:BA230', '41:BB414'],
  )
})
