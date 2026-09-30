import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRAW_PACKAGE_STATUSES,
  canCorrectDrawPackage,
  resolveBillingCutoffDate,
  toCancelDrawPackageRpc,
  toCreateDrawPackageRpc,
  toDrawInvoicePackage,
  toEditDrawPackageRpc,
  toPackageStatusRpc,
  toTransferDrawPackageRpc,
} from '../src/features/draw-invoice/services/drawInvoicePackageRecord.js'
import {
  formatBillingPeriod,
  formatLongDate,
} from '../src/features/draw-invoice/utils/drawInvoiceFormatters.js'

const packageRow = {
  id: 91,
  package_number: 'DP-00000091',
  builder_id: 2,
  job_id: 11,
  phase_id: 21,
  setup_version_id: 31,
  package_date: '2026-09-11',
  invoice_line_format: 'LOT_SCOPE',
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
        phase_id: 21,
        phase_code: '1',
        building: 'P1',
        lot_id: 41,
        draw_id: 52,
        lot_number: '19',
        plan_code: 'A',
        draw_number: 2,
        draw_name: 'Trim',
        event_type: 'DM',
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
    {
      options_billing_draw_number: 2,
      frequency: 'MONTHLY',
      cutoff_day: 20,
      cutoff_days: [],
      cutoff_weekday: null,
      payment_terms_days: 30,
      portal_name: 'Textura',
    },
  )

  assert.equal(record.id, 91)
  assert.equal(record.status, 'READY_TO_SUBMIT')
  assert.deepEqual(record.lotIds, [41])
  assert.deepEqual(record.phaseIds, [21])
  assert.deepEqual(record.drawIndexes, [1])
  assert.deepEqual(record.selections, [{ phaseId: 21, lotId: 41, drawIndex: 1 }])
  assert.equal(record.optionsBillingDrawIndex, 1)
  assert.equal(record.billingCutoffDate, '2026-09-20')
  assert.equal(record.paymentTermsDays, 30)
  assert.equal(record.portalName, 'Textura')
  assert.equal(record.persistedInvoice.grossAmount, 1125.5)
  assert.equal(record.persistedInvoice.netAmount, 1046.71)
  assert.equal(record.persistedDrawLines[0].eventType, 'DM')
  assert.deepEqual(record.persistedOptionLines[0], {
    id: '41:61',
    phaseId: 21,
    phaseCode: '1',
    building: 'P1',
    lotId: 41,
    lotNumber: '19',
    planCode: 'A',
    optionId: 61,
    optionCode: 'OPT-1',
    description: 'Door upgrade',
    price: 125,
    billingDrawIndex: 1,
    issue: null,
  })
})

test('resolves the cutoff date from the Package billing setup snapshot', () => {
  const monthly = {
    frequency: 'MONTHLY',
    cutoff_day: 20,
    cutoff_days: [],
    cutoff_weekday: null,
  }
  const semimonthly = {
    frequency: 'SEMIMONTHLY',
    cutoff_day: null,
    cutoff_days: [10, 25],
    cutoff_weekday: null,
  }
  const weekly = {
    frequency: 'WEEKLY',
    cutoff_day: null,
    cutoff_days: [],
    cutoff_weekday: 5,
  }

  assert.equal(resolveBillingCutoffDate('2026-09-11', monthly), '2026-09-20')
  assert.equal(resolveBillingCutoffDate('2026-09-20', monthly), '2026-09-20')
  assert.equal(resolveBillingCutoffDate('2026-09-21', monthly), '2026-10-20')
  assert.equal(
    resolveBillingCutoffDate('2026-09-11', semimonthly),
    '2026-09-25',
  )
  assert.equal(
    resolveBillingCutoffDate('2026-09-26', semimonthly),
    '2026-10-10',
  )
  assert.equal(resolveBillingCutoffDate('2026-09-11', weekly), '2026-09-11')
  assert.equal(resolveBillingCutoffDate('2026-09-12', weekly), '2026-09-18')
})

test('monthly cutoff dates clamp to the last day of a short month', () => {
  assert.equal(resolveBillingCutoffDate('2026-09-20', {
    frequency: 'MONTHLY',
    cutoff_day: 31,
  }), '2026-09-30')
})

test('Billing Period displays the resolved cutoff date', () => {
  assert.equal(formatBillingPeriod({
    billingCutoffDate: '2026-09-20',
  }), 'Sep 20, 2026')
  assert.equal(formatBillingPeriod({ billingCutoffDate: null }), 'Not set')
})

test('Package creation timestamps use the requested long date format', () => {
  assert.equal(formatLongDate('2026-10-20T23:45:00Z'), 'Oct 20, 2026')
  assert.equal(formatLongDate(null), '—')
})

test('builds Package creation RPC values from UI draw indexes', () => {
  assert.deepEqual(toCreateDrawPackageRpc({
    jobId: '11',
    selections: [
      { lotId: '41', drawIndex: 0 },
      { lotId: 42, drawIndex: 2 },
      { lotId: 41, drawIndex: 1 },
    ],
  }), {
    p_job_id: 11,
    p_selections: [
      { lot_id: 41, draw_number: 1 },
      { lot_id: 42, draw_number: 3 },
      { lot_id: 41, draw_number: 2 },
    ],
  })
})

test('adds explicit Option ids only to the configured billing Draw cells', () => {
  assert.deepEqual(toCreateDrawPackageRpc({
    jobId: '11',
    selections: [
      { lotId: '41', drawIndex: 0 },
      { lotId: 41, drawIndex: 1 },
      { lotId: 42, drawIndex: 1 },
    ],
    optionSelections: [
      { lotId: 40, optionId: 70 },
      { lotId: 41, optionId: 63 },
      { lotId: 41, optionId: 61 },
      { lotId: 41, optionId: 61 },
    ],
    optionsBillingDrawIndex: 1,
  }), {
    p_job_id: 11,
    p_selections: [
      { lot_id: 41, draw_number: 1 },
      {
        lot_id: 41,
        draw_number: 2,
        package_options: [
          { lot_id: 40, option_id: 70 },
          { lot_id: 41, option_id: 61 },
          { lot_id: 41, option_id: 63 },
        ],
      },
      { lot_id: 42, draw_number: 2 },
    ],
  })
})

test('an Options billing Draw anchor explicitly supports charging no Options', () => {
  assert.deepEqual(toCreateDrawPackageRpc({
    jobId: 11,
    selections: [
      { lotId: 41, drawIndex: 1 },
      { lotId: 42, drawIndex: 1 },
    ],
    optionSelections: [],
    optionsBillingDrawIndex: 1,
  }), {
    p_job_id: 11,
    p_selections: [
      { lot_id: 41, draw_number: 2, package_options: [] },
      { lot_id: 42, draw_number: 2 },
    ],
  })
})

test('a later Draw can be the Package Option charge anchor', () => {
  assert.deepEqual(toCreateDrawPackageRpc({
    jobId: 11,
    selections: [
      { lotId: 41, drawIndex: 0 },
      { lotId: 42, drawIndex: 2 },
    ],
    optionSelections: [{ lotId: 40, optionId: 70 }],
    optionsBillingDrawIndex: 1,
  }), {
    p_job_id: 11,
    p_selections: [
      { lot_id: 41, draw_number: 1 },
      {
        lot_id: 42,
        draw_number: 3,
        package_options: [{ lot_id: 40, option_id: 70 }],
      },
    ],
  })
})

test('maps a deferred Option from its own immutable Lot snapshot', () => {
  const record = toDrawInvoicePackage(
    packageRow,
    { id: 101, status: 'DRAFT', paid_amount: '0' },
    [{
      phase_id: 21,
      phase_code: '1',
      building: 'P1',
      lot_id: 42,
      draw_id: 52,
      lot_number: '20',
      plan_code: 'B',
      draw_number: 3,
    }],
    [{
      lot_id: 41,
      billing_lot_id: 42,
      option_id: 61,
      draw_id: 52,
      option_code: 'OPT-1',
      option_name: 'Door upgrade',
      option_price: '125',
      phase_id: 20,
      phase_code: 'A',
      building: 'Building 9',
      lot_number: '19',
      plan_code: '2A',
    }],
  )

  assert.deepEqual(record.persistedOptionLines[0], {
    id: '41:61',
    phaseId: 20,
    phaseCode: 'A',
    building: 'Building 9',
    lotId: 41,
    lotNumber: '19',
    planCode: '2A',
    optionId: 61,
    optionCode: 'OPT-1',
    description: 'Door upgrade',
    price: 125,
    billingDrawIndex: 2,
    issue: null,
  })
})

test('derives a multi-Phase Package scope from its immutable draw lines', () => {
  const record = toDrawInvoicePackage(
    { ...packageRow, phase_id: null },
    { id: 101, status: 'DRAFT', paid_amount: '0' },
    [
      {
        phase_id: 21, phase_code: '1', building: 'P1',
        lot_id: 41, draw_id: 51, lot_number: '97', plan_code: 'A',
        draw_number: 3, event_type: 'HW',
      },
      {
        phase_id: 22, phase_code: '2', building: 'P2',
        lot_id: 42, draw_id: 52, lot_number: '20', plan_code: 'B',
        draw_number: 2, event_type: 'DM',
      },
    ],
  )

  assert.equal(record.phaseId, 21)
  assert.deepEqual(record.phaseIds, [21, 22])
  assert.deepEqual(record.selections, [
    { phaseId: 21, lotId: 41, drawIndex: 2 },
    { phaseId: 22, lotId: 42, drawIndex: 1 },
  ])
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

test('maps cancelled Packages and correction history without active cells', () => {
  const correction = { id: 7, action: 'CANCEL', reason: 'Wrong scope' }
  const record = toDrawInvoicePackage(
    {
      ...packageRow,
      status: 'VOIDED',
      voided_at: '2026-09-15T12:00:00Z',
      void_reason: 'Wrong scope',
    },
    {
      id: 101,
      status: 'DRAFT',
      gross_amount: '0',
      net_amount: '0',
      paid_amount: '0',
    },
    [], [], null, [correction],
  )

  assert.equal(record.status, 'CANCELLED')
  assert.equal(record.cancellationReason, 'Wrong scope')
  assert.equal(record.persistedInvoice.netAmount, 0)
  assert.deepEqual(record.selections, [])
  assert.deepEqual(record.corrections, [correction])
  assert.equal(canCorrectDrawPackage(record), false)
})

test('only unissued and unsynced drafts are correctable', () => {
  const draft = toDrawInvoicePackage(
    { ...packageRow, status: 'DRAFT', workflow_status: 'DRAFT' },
    { id: 101, status: 'DRAFT', paid_amount: '0' },
  )
  assert.equal(canCorrectDrawPackage(draft), true)
  assert.equal(canCorrectDrawPackage({ ...draft, quickbooksStatus: 'CREATED' }), false)
  assert.equal(canCorrectDrawPackage({ ...draft, invoiceNumber: 'INV-1' }), false)
  assert.equal(canCorrectDrawPackage({ ...draft, submissionStatus: 'SUBMITTED' }), false)
  assert.equal(canCorrectDrawPackage({ ...draft, status: 'AWAITING_PAYMENT' }), false)
})

test('builds edit, transfer and cancel RPC payloads with exact Lot / Draw cells', () => {
  const selections = [{ lotId: '41', drawIndex: 0 }, { lotId: 42, drawIndex: 2 }]
  const cells = [
    { lot_id: 41, draw_number: 1 },
    { lot_id: 42, draw_number: 3 },
  ]
  assert.deepEqual(toEditDrawPackageRpc({
    packageId: '91', selections, reason: ' Fix scope ',
    notes: ' Draft ',
  }), {
    p_package_id: 91,
    p_selections: cells,
    p_reason: 'Fix scope',
    p_notes: 'Draft',
  })
  assert.deepEqual(toTransferDrawPackageRpc({
    toPackageId: 91, fromPackageId: '92', selections, reason: ' Put in earlier package ',
  }), {
    p_to_package_id: 91,
    p_from_package_id: 92,
    p_selections: cells,
    p_reason: 'Put in earlier package',
  })
  assert.deepEqual(toCancelDrawPackageRpc('92', ' Wrong job '), {
    p_package_id: 92,
    p_reason: 'Wrong job',
  })
  assert.throws(() => toEditDrawPackageRpc({ selections: [] }), /Select at least one/)
})
