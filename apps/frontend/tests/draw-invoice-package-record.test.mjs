import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRAW_PACKAGE_STATUSES,
  canCorrectDrawPackage,
  toCreateRetentionReleasePackageRpc,
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

test('Retention Release RPC keeps Job scope nullable and normalizes notes', () => {
  assert.deepEqual(toCreateRetentionReleasePackageRpc({
    jobId: '11',
    phaseId: null,
    notes: ' Final retention ',
  }), {
    p_job_id: 11,
    p_phase_id: null,
    p_notes: 'Final retention',
  })
})

test('maps a positive Retention Release package and its immutable source lines', () => {
  const record = toDrawInvoicePackage(
    {
      id: 99,
      package_number: 'RP-00000099',
      package_type: 'RETENTION_RELEASE',
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
      id: 109,
      package_id: 99,
      gross_amount: '440.00',
      retention_amount: '0',
      wrap_amount: '0',
      net_amount: '440.00',
      paid_amount: '0',
      status: 'DRAFT',
    },
    [],
    [],
    null,
    [],
    {
      package_id: 99,
      scope_type: 'JOB',
      phase_id: null,
      phase_code: null,
      building: null,
      source_cutoff_date: '2026-09-20',
      available_date: '2026-10-20',
      retained_amount: '440.00',
    },
    [{
      package_id: 99,
      source_package_id: 10,
      source_lot_id: 101,
      source_draw_id: 501,
      phase_id: 21,
      retention_amount: '55.00',
    }],
    [],
    [{
      package_id: 99,
      source_hardware_line_id: 801,
      source_package_id: 10,
      source_lot_id: 101,
      hardware_event_type: 'HW',
      phase_id: 21,
      retention_amount: '22.00',
    }],
  )

  assert.equal(record.packageType, 'RETENTION_RELEASE')
  assert.equal(record.retentionRelease.scopeType, 'JOB')
  assert.equal(record.retentionRelease.retainedAmount, 440)
  assert.deepEqual(record.retentionRelease.sourceLines[0], {
    sourcePackageId: 10,
    sourceLotId: 101,
    sourceDrawId: 501,
    phaseId: 21,
    retentionAmount: 55,
  })
  assert.deepEqual(record.retentionRelease.sourceHardwareLines[0], {
    sourceHardwareLineId: 801,
    sourcePackageId: 10,
    sourceLotId: 101,
    hardwareEventType: 'HW',
    phaseId: 21,
    retentionAmount: 22,
  })
  assert.equal(record.persistedInvoice.netAmount, 440)
  assert.deepEqual(record.persistedDrawLines, [])
})

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
        hardware_billing_mode: 'BY_EVENT',
        hardware_event_type: null,
        hardware_percentage: '0',
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
      separate_hardware_price: true,
      hardware_billing_mode: 'BY_EVENT',
      hardware_ext_percentage: '20',
      hardware_dm_percentage: '30',
      hardware_hw_percentage: '50',
      hardware_billing_draw_number: 2,
      options_billing_draw_number: 2,
      frequency: 'MONTHLY',
      cutoff_day: 20,
      cutoff_days: [],
      cutoff_weekday: null,
      payment_terms_days: 30,
      submission_method: 'EMAIL',
      submission_destination: 'billing@example.com',
      portal_name: 'Textura',
    },
  )

  assert.equal(record.id, 91)
  // A Package still stored as "ready to submit" is a Draft: that status was removed.
  assert.equal(record.status, 'DRAFT')
  assert.deepEqual(record.lotIds, [41])
  assert.deepEqual(record.phaseIds, [21])
  assert.deepEqual(record.drawIndexes, [1])
  assert.deepEqual(record.selections, [{
    phaseId: 21,
    lotId: 41,
    drawIndex: 1,
    chargeHardware: false,
  }])
  assert.equal(record.separateHardwarePrice, true)
  assert.equal(record.hardwareBillingMode, 'BY_EVENT')
  assert.deepEqual(record.hardwareEventPercentages, { EXT: 20, DM: 30, HW: 50 })
  assert.equal(record.optionsBillingDrawIndex, 1)
  assert.equal(record.billingCutoffDate, '2026-09-20')
  assert.equal(record.paymentTermsDays, 30)
  assert.equal(record.submissionMethod, 'EMAIL')
  assert.equal(record.submissionDestination, 'billing@example.com')
  assert.equal(record.portalName, '')
  assert.equal(record.persistedInvoice.grossAmount, 1125.5)
  assert.equal(record.persistedInvoice.netAmount, 1046.71)
  assert.equal(record.persistedDrawLines[0].eventType, 'DM')
  assert.equal(record.persistedDrawLines[0].hardwareBillingMode, 'BY_EVENT')
  assert.equal(record.persistedDrawLines[0].hardwareEventType, null)
  assert.equal(record.persistedDrawLines[0].hardwarePercentage, 0)
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

test('maps immutable Utility Building draw snapshots', () => {
  const record = toDrawInvoicePackage(
    packageRow,
    {
      id: 102,
      gross_amount: '12500',
      retention_amount: '0',
      wrap_amount: '0',
      net_amount: '12500',
      paid_amount: '0',
      status: 'DRAFT',
    },
    [{
      phase_id: 22,
      phase_code: 'UTILITY',
      building: 'CLUBHOUSE',
      lot_id: 72,
      draw_id: 53,
      lot_number: 'UTILITY-1',
      utility_name: 'Clubhouse',
      plan_code: 'CLUB',
      draw_number: 2,
      draw_name: 'Hardware',
      event_type: 'HW',
      is_utility_building: true,
      base_draw_amount: '0',
      hardware_amount: '0',
      options_amount: '0',
      utility_amount: '12500',
      gross_amount: '12500',
      retention_amount: '0',
      wrap_amount: '0',
      net_amount: '12500',
    }],
    [],
    {
      utility_building: true,
      separate_hardware_price: true,
      options_billing_draw_number: 2,
      frequency: 'MONTHLY',
      cutoff_day: 20,
    },
  )

  assert.equal(record.utilityBuilding, true)
  assert.equal(record.persistedDrawLines[0].isUtilityBuilding, true)
  assert.equal(record.persistedDrawLines[0].utilityLabel, 'Clubhouse')
  assert.equal(record.persistedDrawLines[0].utilityAmount, 12500)
  assert.equal(record.persistedDrawLines[0].baseDrawAmount, 0)
  assert.equal(record.persistedDrawLines[0].hardwareAmount, 0)
  assert.deepEqual(record.lotIds, [72])
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
  assert.equal(formatBillingPeriod({
    billingCutoffDate: null,
    billingCutoffAnyDate: true,
  }), 'Any date')
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

test('adds Hardware only to the explicitly selected Lot and Draw cells', () => {
  assert.deepEqual(toCreateDrawPackageRpc({
    jobId: 11,
    selections: [
      { phaseId: 21, lotId: 41, drawIndex: 0 },
      { phaseId: 21, lotId: 41, drawIndex: 1 },
      { phaseId: 21, lotId: 42, drawIndex: 1 },
    ],
    hardwareSelections: [
      { phaseId: 21, lotId: 41, drawIndex: 1 },
      { phaseId: 21, lotId: 42, drawIndex: 1 },
    ],
  }), {
    p_job_id: 11,
    p_selections: [
      { lot_id: 41, draw_number: 1 },
      { lot_id: 41, draw_number: 2, charge_hardware: true },
      { lot_id: 42, draw_number: 2, charge_hardware: true },
    ],
  })
})

test('sends Calendar-triggered Separate Hardware independently from Draw cells', () => {
  assert.deepEqual(toCreateDrawPackageRpc({
    jobId: 11,
    selections: [],
    hardwareSelections: [
      { phaseId: 21, lotId: 42, eventType: 'HW' },
      { phaseId: 21, lotId: 41, eventType: 'EXT' },
      { phaseId: 21, lotId: 41, eventType: 'EXT' },
    ],
  }), {
    p_job_id: 11,
    p_selections: [],
    p_hardware_selections: [
      { lot_id: 41, event_type: 'EXT' },
      { lot_id: 42, event_type: 'HW' },
    ],
  })
})

test('maps immutable Separate Hardware snapshots without an HW Draw', () => {
  const record = toDrawInvoicePackage(
    { ...packageRow, phase_id: 21 },
    {
      id: 101,
      status: 'DRAFT',
      gross_amount: '600',
      retention_amount: '30',
      wrap_amount: '0',
      net_amount: '570',
      paid_amount: '0',
    },
    [], [], {
      separate_hardware_price: true,
      hardware_billing_mode: 'BY_EVENT',
      hardware_ext_percentage: 0,
      hardware_dm_percentage: 0,
      hardware_hw_percentage: 100,
    }, [], null, [], [{
      id: 801,
      package_id: 91,
      phase_id: 21,
      phase_code: '1',
      building: 'A',
      lot_id: 41,
      lot_number: '101',
      plan_code: 'A',
      hardware_price: '600',
      hardware_event_type: 'HW',
      hardware_percentage: '100',
      hardware_amount: '600',
      gross_amount: '600',
      retention_amount: '30',
      wrap_amount: '0',
      net_amount: '570',
    }],
  )

  assert.deepEqual(record.phaseIds, [21])
  assert.deepEqual(record.lotIds, [41])
  assert.deepEqual(record.selections, [])
  assert.deepEqual(record.persistedHardwareLines[0], {
    id: 801,
    packageId: 91,
    phaseId: 21,
    phaseCode: '1',
    building: 'A',
    lotId: 41,
    lotNumber: '101',
    planCode: 'A',
    hardwarePrice: 600,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventType: 'HW',
    eventType: 'HW',
    hardwarePercentage: 100,
    hardwareAmount: 600,
    grossAmount: 600,
    retentionAmount: 30,
    wrapAmount: 0,
    netAmount: 570,
    drawIndex: null,
    drawName: '',
    isUtilityBuilding: false,
  })
  assert.equal(canCorrectDrawPackage(record), false)
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
    { phaseId: 21, lotId: 41, drawIndex: 2, chargeHardware: false },
    { phaseId: 22, lotId: 42, drawIndex: 1, chargeHardware: false },
  ])
})

test('exposes exactly the requested Package statuses', () => {
  assert.deepEqual(DRAW_PACKAGE_STATUSES, [
    'DRAFT',
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
  const selections = [
    { lotId: '41', drawIndex: 0, chargeHardware: true },
    { lotId: 42, drawIndex: 2 },
  ]
  const cells = [
    { lot_id: 41, draw_number: 1, charge_hardware: true },
    { lot_id: 42, draw_number: 3, charge_hardware: false },
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
