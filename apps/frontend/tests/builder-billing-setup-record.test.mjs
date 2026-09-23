import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toBuilderBillingSetupRpc,
  toBuilderDrawSchedule,
} from '../src/features/builder-draw-schedules/services/builderBillingSetupRecord.js'

test('billing setup records map database columns and one-based draws to the form', () => {
  const version = {
    id: 91,
    builder_id: 7,
    version_number: 3,
    status: 'ACTIVE',
    separate_hardware_price: true,
    hardware_billing_draw_number: 3,
    options_billing_draw_number: 2,
    frequency: 'SEMIMONTHLY',
    cutoff_day: null,
    submission_day: null,
    cutoff_days: [10, 25],
    cutoff_weekday: null,
    submission_offset_days: 3,
    work_accepted_through: 'CUTOFF',
    invoice_date_rule: 'SUBMISSION',
    payment_terms_days: 30,
    retention_enabled: true,
    retention_percentage: '5.25',
    wrap_enabled: true,
    wrap_percentage: '2.50',
    invoice_line_format: 'LOT_SCOPE',
    portal_name: 'Textura',
    notes: null,
  }
  const draws = [
    { setup_version_id: 91, draw_number: 2, name: null, percentage: '75.00' },
    { setup_version_id: 22, draw_number: 1, name: 'Other', percentage: '50.00' },
    { setup_version_id: 91, draw_number: 1, name: 'Start', percentage: '10.00' },
    { setup_version_id: 91, draw_number: 3, name: 'Final', percentage: '15.00' },
  ]
  const documents = [
    { setup_version_id: 91, document_type: 'INVOICE', is_required: true },
    { setup_version_id: 91, document_type: 'PURCHASE_ORDER', is_required: true },
    { setup_version_id: 91, document_type: 'RELEASE', is_required: true },
    { setup_version_id: 91, document_type: 'BACKUP', is_required: false },
  ]

  const schedule = toBuilderDrawSchedule(version, draws, documents)

  assert.equal(schedule.builderId, 7)
  assert.equal(schedule.versionNumber, 3)
  assert.deepEqual(schedule.draws, [
    { name: 'Start', percentage: 10 },
    { name: '', percentage: 75 },
    { name: 'Final', percentage: 15 },
  ])
  assert.equal(schedule.hardwareBillingDrawIndex, 2)
  assert.equal(schedule.optionsBillingDrawIndex, 1)
  assert.equal(schedule.ocipWrapEnabled, true)
  assert.equal(schedule.ocipWrapPercentage, 2.5)
  assert.equal(schedule.requiresPo, true)
  assert.equal(schedule.requiresRelease, true)
  assert.equal(schedule.requiresBackup, false)
})

test('form values map to normalized RPC payloads and one-based draw numbers', () => {
  const payload = toBuilderBillingSetupRpc({
    builderId: 7,
    draws: [
      { name: ' Start ', percentage: '25' },
      { name: '', percentage: 75 },
    ],
    separateHardwarePrice: true,
    hardwareBillingDrawIndex: 1,
    optionsBillingDrawIndex: 0,
    frequency: 'WEEKLY',
    cutoffDay: 20,
    submissionDay: 25,
    cutoffDays: [10, 25],
    cutoffWeekday: 5,
    submissionOffsetDays: 2,
    workAcceptedThrough: 'SUBMISSION',
    invoiceDateRule: 'CUTOFF',
    paymentTermsDays: 45,
    retentionEnabled: true,
    retentionPercentage: 5,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 2,
    requiresPo: true,
    requiresPaymentSchedule: false,
    requiresRelease: true,
    requiresBackup: false,
    invoiceLineFormat: 'LOT',
    portalName: ' Builder Portal ',
    notes: ' Instructions ',
  })

  assert.equal(payload.p_builder_id, 7)
  assert.equal(payload.p_config.hardwareBillingDrawNumber, 2)
  assert.equal(payload.p_config.optionsBillingDrawNumber, 1)
  assert.equal(payload.p_config.cutoffDay, null)
  assert.equal(payload.p_config.submissionDay, null)
  assert.deepEqual(payload.p_config.cutoffDays, [])
  assert.equal(payload.p_config.cutoffWeekday, 5)
  assert.equal(payload.p_config.wrapEnabled, true)
  assert.equal(payload.p_config.wrapPercentage, 2)
  assert.equal(payload.p_config.portalName, 'Builder Portal')
  assert.deepEqual(payload.p_draws, [
    { drawNumber: 1, name: 'Start', percentage: 25 },
    { drawNumber: 2, name: null, percentage: 75 },
  ])
  assert.deepEqual(
    payload.p_required_documents.map(({ type }) => type),
    ['PURCHASE_ORDER', 'RELEASE'],
  )
})
