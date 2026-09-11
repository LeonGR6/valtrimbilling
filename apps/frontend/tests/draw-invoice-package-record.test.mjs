import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRAW_PACKAGE_STATUSES,
  toCreateDrawPackageRpc,
  toDrawInvoicePackage,
  toPackageStatusRpc,
} from '../src/features/draw-invoice/services/drawInvoicePackageRecord.js'

const packageRow = {
  id: 91,
  package_number: 'DP-00000091',
  builder_id: 2,
  job_id: 11,
  phase_id: 21,
  setup_version_id: 31,
  package_date: '2026-09-11',
  billing_period_start: null,
  billing_period_end: null,
  payment_terms_days: 30,
  invoice_line_format: 'LOT_SCOPE',
  portal_name: null,
  workflow_status: 'READY_TO_SUBMIT',
  notes: null,
  created_at: '2026-09-11T12:00:00Z',
  updated_at: '2026-09-11T12:30:00Z',
  status_changed_at: '2026-09-11T12:30:00Z',
  status_changed_by: '00000000-0000-0000-0000-000000000091',
}

test('maps persisted package, invoice and calculated snapshots to the UI model', () => {
  const record = toDrawInvoicePackage(
    packageRow,
    {
      id: 101,
      invoice_number: null,
      invoice_date: null,
      due_date: null,
      gross_amount: '1125.50',
      retention_amount: '56.28',
      wrap_amount: '22.51',
      net_amount: '1046.71',
      paid_amount: '0',
      status: 'DRAFT',
    },
    [
      {
        lot_id: 41,
        draw_id: 52,
        lot_number: '19',
        plan_code: 'A',
        draw_number: 2,
        draw_name: 'Trim',
        base_draw_amount: '1000.50',
        hardware_amount: '0',
        options_amount: '125',
        gross_amount: '1125.50',
        retention_amount: '56.28',
        wrap_amount: '22.51',
        net_amount: '1046.71',
      },
    ],
    [
      {
        lot_id: 41,
        option_id: 61,
        draw_id: 52,
        option_code: 'OPT-1',
        option_name: 'Door upgrade',
        option_price: '125',
      },
    ],
    { options_billing_draw_number: 2 },
  )

  assert.equal(record.id, 91)
  assert.equal(record.status, 'READY_TO_SUBMIT')
  assert.deepEqual(record.lotIds, [41])
  assert.deepEqual(record.drawIndexes, [1])
  assert.deepEqual(record.selections, [{ lotId: 41, drawIndex: 1 }])
  assert.equal(record.optionsBillingDrawIndex, 1)
  assert.equal(record.persistedInvoice.grossAmount, 1125.5)
  assert.equal(record.persistedInvoice.netAmount, 1046.71)
  assert.deepEqual(record.persistedOptionLines[0], {
    id: '41:61',
    lotId: 41,
    lotNumber: '19',
    planCode: 'A',
    optionId: 61,
    optionCode: 'OPT-1',
    description: 'Door upgrade',
    price: 125,
    issue: null,
  })
})

test('builds Package creation RPC values from UI draw indexes', () => {
  assert.deepEqual(toCreateDrawPackageRpc({
    phaseId: '21',
    lotIds: ['41', 42],
    drawIndexes: [0, 2],
  }), {
    p_phase_id: 21,
    p_lot_ids: [41, 42],
    p_draw_numbers: [1, 3],
  })
})

test('exposes exactly the requested Package statuses', () => {
  assert.deepEqual(DRAW_PACKAGE_STATUSES, [
    'DRAFT',
    'READY_TO_SUBMIT',
    'AWAITING_PAYMENT',
    'PAID_CLOSED',
  ])

  assert.deepEqual(toPackageStatusRpc('91', 'PAID_CLOSED'), {
    p_package_id: 91,
    p_status: 'PAID_CLOSED',
  })
  assert.throws(
    () => toPackageStatusRpc(91, 'VOIDED'),
    /valid Package status/,
  )
})
