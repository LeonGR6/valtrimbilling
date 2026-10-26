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
    hardware_billing_mode: 'BY_EVENT',
    hardware_ext_percentage: '20.00',
    hardware_dm_percentage: '30.00',
    hardware_hw_percentage: '50.00',
    utility_building: true,
    utility_billing_mode: 'BY_EVENT',
    utility_ext_percentage: '25.00',
    utility_dm_percentage: '50.00',
    utility_hw_percentage: '25.00',
    hardware_billing_draw_number: 3,
    options_billing_draw_number: 2,
    frequency: 'SEMIMONTHLY',
    cutoff_any_date: false,
    cutoff_day: null,
    cutoff_days: [10, 25],
    cutoff_weekday: null,
    payment_terms_days: 30,
    retention_enabled: true,
    retention_percentage: '5.25',
    retention_release_scope: 'BUILDING',
    final_release_scope: 'PHASE',
    wrap_enabled: true,
    wrap_percentage: '2.50',
    invoice_line_format: 'LOT',
    submission_method: 'PORTAL',
    submission_destination: 'Textura',
    portal_name: 'Textura',
    notes: null,
  }
  const draws = [
    { setup_version_id: 91, draw_number: 2, name: null, percentage: '75.00', event_type: 'DM' },
    { setup_version_id: 22, draw_number: 1, name: 'Other', percentage: '50.00', event_type: 'EXT' },
    { setup_version_id: 91, draw_number: 1, name: 'Start', percentage: '10.00', event_type: 'EXT' },
    { setup_version_id: 91, draw_number: 3, name: 'Final', percentage: '15.00', event_type: 'HW', lag_value: 1, lag_unit: 'MONTHS' },
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
    { name: 'Start', percentage: 10, eventType: 'EXT', lag: null },
    { name: '', percentage: 75, eventType: 'DM', lag: null },
    { name: 'Final', percentage: 15, eventType: 'HW', lag: { value: 1, unit: 'MONTHS' } },
  ])
  assert.equal('hardwareBillingDrawIndex' in schedule, false)
  assert.equal(schedule.hardwareBillingMode, 'BY_EVENT')
  assert.deepEqual(schedule.hardwareEventPercentages, { EXT: 20, DM: 30, HW: 50 })
  assert.equal(schedule.utilityBuilding, true)
  assert.equal(schedule.utilityBillingMode, 'BY_EVENT')
  assert.deepEqual(schedule.utilityEventPercentages, { EXT: 25, DM: 50, HW: 25 })
  assert.equal(schedule.optionsBillingDrawIndex, 1)
  assert.equal(schedule.anyDate, false)
  assert.equal(schedule.ocipWrapEnabled, true)
  assert.equal(schedule.retentionReleaseScope, 'BUILDING')
  assert.equal(schedule.ocipWrapPercentage, 2.5)
  assert.equal(schedule.requiresPo, true)
  assert.equal(schedule.requiresRelease, true)
  assert.equal(schedule.finalReleaseScope, 'PHASE')
  assert.equal(schedule.requiresBackup, false)
  assert.equal(schedule.invoiceLineFormat, 'LOT_SCOPE')
  assert.equal(schedule.submissionMethod, 'PORTAL')
  assert.equal(schedule.submissionDestination, 'Textura')
})

test('form values map to normalized RPC payloads and one-based draw numbers', () => {
  const payload = toBuilderBillingSetupRpc({
    builderId: 7,
    draws: [
      { name: ' Start ', percentage: '25', eventType: 'HW' },
      { name: '', percentage: 75, eventType: 'HW', lag: { value: '1', unit: 'MONTHS' } },
    ],
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
    utilityBuilding: true,
    utilityBillingMode: 'BY_EVENT',
    utilityEventPercentages: { EXT: 0, DM: 0, HW: 100 },
    optionsBillingDrawIndex: 0,
    frequency: 'WEEKLY',
    anyDate: false,
    cutoffDay: 20,
    cutoffDays: [10, 25],
    cutoffWeekday: 5,
    paymentTermsDays: 45,
    retentionEnabled: true,
    retentionPercentage: 5,
    retentionReleaseScope: 'BUILDING',
    ocipWrapEnabled: true,
    ocipWrapPercentage: 2,
    requiresPo: true,
    requiresPaymentSchedule: false,
    requiresRelease: true,
    finalReleaseScope: 'BUILDING',
    requiresBackup: false,
    invoiceLineFormat: 'BUILDING_SCOPE',
    submissionMethod: 'EMAIL',
    submissionDestination: ' billing@example.com ',
    notes: ' Instructions ',
  })

  assert.equal(payload.p_builder_id, 7)
  assert.equal(payload.p_config.finalReleaseScope, 'BUILDING')
  assert.equal('hardwareBillingDrawNumber' in payload.p_config, false)
  assert.equal(payload.p_config.hardwareBillingMode, 'BY_EVENT')
  assert.equal(payload.p_config.hardwareExtPercentage, 0)
  assert.equal(payload.p_config.hardwareDmPercentage, 0)
  assert.equal(payload.p_config.hardwareHwPercentage, 100)
  assert.equal(payload.p_config.utilityBuilding, true)
  assert.equal(payload.p_config.utilityBillingMode, 'BY_EVENT')
  assert.equal(payload.p_config.utilityExtPercentage, 0)
  assert.equal(payload.p_config.utilityDmPercentage, 0)
  assert.equal(payload.p_config.utilityHwPercentage, 100)
  assert.equal(payload.p_config.optionsBillingDrawNumber, 1)
  assert.equal(payload.p_config.cutoffDay, null)
  assert.deepEqual(payload.p_config.cutoffDays, [])
  assert.equal(payload.p_config.cutoffWeekday, 5)
  assert.equal(payload.p_config.cutoffAnyDate, false)
  assert.equal('submissionDay' in payload.p_config, false)
  assert.equal('submissionOffsetDays' in payload.p_config, false)
  assert.equal('workAcceptedThrough' in payload.p_config, false)
  assert.equal('invoiceDateRule' in payload.p_config, false)
  assert.equal(payload.p_config.wrapEnabled, true)
  assert.equal(payload.p_config.retentionReleaseScope, 'BUILDING')
  assert.equal(payload.p_config.wrapPercentage, 2)
  assert.equal(payload.p_config.invoiceLineFormat, 'BUILDING_SCOPE')
  assert.equal(payload.p_config.submissionMethod, 'EMAIL')
  assert.equal(payload.p_config.submissionDestination, 'billing@example.com')
  assert.equal(payload.p_config.portalName, null)
  assert.deepEqual(payload.p_draws, [
    { drawNumber: 1, name: 'Start', percentage: 25, eventType: 'HW', lagValue: null, lagUnit: null },
    { drawNumber: 2, name: null, percentage: 75, eventType: 'HW', lagValue: 1, lagUnit: 'MONTHS' },
  ])
  assert.deepEqual(
    payload.p_required_documents.map(({ type }) => type),
    ['PURCHASE_ORDER', 'RELEASE'],
  )
})

test('monthly Any date is persisted without a fixed cutoff day', () => {
  const payload = toBuilderBillingSetupRpc({
    builderId: 7,
    draws: [
      { name: '', percentage: 50, eventType: 'EXT' },
      { name: '', percentage: 50, eventType: 'DM' },
    ],
    separateHardwarePrice: false,
    utilityBuilding: false,
    optionsBillingDrawIndex: null,
    frequency: 'MONTHLY',
    anyDate: true,
    cutoffDay: 20,
    cutoffDays: [10, 25],
    cutoffWeekday: 5,
    paymentTermsDays: 30,
    retentionEnabled: false,
    retentionPercentage: 0,
    ocipWrapEnabled: false,
    ocipWrapPercentage: 0,
    requiresPo: false,
    requiresPaymentSchedule: false,
    requiresRelease: false,
    requiresBackup: false,
    invoiceLineFormat: 'LOT_SCOPE',
    submissionMethod: 'PORTAL',
    submissionDestination: '',
    notes: '',
  })

  assert.equal(payload.p_config.cutoffAnyDate, true)
  assert.equal(payload.p_config.cutoffDay, null)
  assert.deepEqual(payload.p_config.cutoffDays, [])
  assert.equal(payload.p_config.cutoffWeekday, null)
})

test('legacy portal records load as Portal submissions', () => {
  const schedule = toBuilderDrawSchedule({
    id: 92,
    builder_id: 8,
    version_number: 1,
    status: 'ACTIVE',
    separate_hardware_price: false,
    utility_building: false,
    hardware_billing_draw_number: null,
    options_billing_draw_number: null,
    frequency: 'MONTHLY',
    cutoff_any_date: false,
    cutoff_day: 20,
    cutoff_days: [],
    cutoff_weekday: null,
    payment_terms_days: 30,
    retention_enabled: false,
    retention_percentage: '0',
    wrap_enabled: false,
    wrap_percentage: '0',
    invoice_line_format: 'LOT_SCOPE',
    submission_method: 'PORTAL',
    submission_destination: null,
    portal_name: 'Legacy Portal',
    notes: null,
  })

  assert.equal(schedule.submissionMethod, 'PORTAL')
  assert.equal(schedule.submissionDestination, 'Legacy Portal')
  assert.equal(schedule.retentionReleaseScope, 'JOB')
})

test('The Conditional Final scope is only kept while a Release is required', () => {
  const base = {
    id: 5,
    builder_id: 7,
    version_number: 1,
    status: 'CURRENT',
    final_release_scope: 'PROJECT',
    frequency: 'MONTHLY',
    cutoff_day: 20,
    payment_terms_days: 30,
    invoice_line_format: 'LOT',
    submission_method: 'PORTAL',
  }
  const withRelease = toBuilderDrawSchedule(
    base,
    [{ setup_version_id: 5, draw_number: 1, percentage: '100.00', event_type: 'EXT' }],
    [{ setup_version_id: 5, document_type: 'RELEASE', is_required: true }],
  )
  const withoutRelease = toBuilderDrawSchedule(
    base,
    [{ setup_version_id: 5, draw_number: 1, percentage: '100.00', event_type: 'EXT' }],
    [],
  )
  assert.equal(withRelease.finalReleaseScope, 'PROJECT')
  assert.equal(withoutRelease.finalReleaseScope, '')

  const payload = toBuilderBillingSetupRpc({ ...withoutRelease, finalReleaseScope: 'PROJECT' })
  assert.equal(payload.p_config.finalReleaseScope, null)
})

test('each setup version requires only its own documents when several are loaded together', () => {
  const version = (id, versionNumber) => ({
    id,
    builder_id: 7,
    version_number: versionNumber,
    status: versionNumber === 2 ? 'ACTIVE' : 'SUPERSEDED',
    final_release_scope: 'PROJECT',
    frequency: 'MONTHLY',
    cutoff_day: 20,
    payment_terms_days: 30,
    invoice_line_format: 'LOT',
    submission_method: 'PORTAL',
  })
  // Version 1 required the three documents; version 2 only asks for the Purchase order.
  const documents = [
    { setup_version_id: 1, document_type: 'PURCHASE_ORDER', is_required: true },
    { setup_version_id: 1, document_type: 'PAYMENT_SCHEDULE', is_required: true },
    { setup_version_id: 1, document_type: 'RELEASE', is_required: true },
    { setup_version_id: 2, document_type: 'PURCHASE_ORDER', is_required: true },
    { setup_version_id: 2, document_type: 'PAYMENT_SCHEDULE', is_required: false },
    { setup_version_id: 2, document_type: 'RELEASE', is_required: false },
    { setup_version_id: 3, document_type: 'BACKUP', is_required: true },
  ]
  const draws = []

  const first = toBuilderDrawSchedule(version(1, 1), draws, documents)
  const second = toBuilderDrawSchedule(version(2, 2), draws, documents)

  assert.deepEqual(
    [first.requiresPo, first.requiresPaymentSchedule, first.requiresRelease, first.requiresBackup],
    [true, true, true, false],
  )
  assert.deepEqual(
    [second.requiresPo, second.requiresPaymentSchedule, second.requiresRelease, second.requiresBackup],
    [true, false, false, false],
  )
  // Unchecking the Release also drops the Conditional Final scope that depends on it.
  assert.equal(first.finalReleaseScope, 'PROJECT')
  assert.equal(second.finalReleaseScope, '')
})
