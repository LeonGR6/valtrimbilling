const requiredDocumentDefinitions = [
  {
    field: 'requiresPo',
    type: 'PURCHASE_ORDER',
    label: 'Purchase order',
  },
  {
    field: 'requiresPaymentSchedule',
    type: 'PAYMENT_SCHEDULE',
    label: 'Payment schedule',
  },
  {
    field: 'requiresRelease',
    type: 'RELEASE',
    label: 'Release',
  },
  {
    field: 'requiresBackup',
    type: 'BACKUP',
    label: 'Backup documentation',
  },
]

function optionalDrawIndex(drawNumber) {
  return drawNumber == null ? null : Number(drawNumber) - 1
}

function toNumber(value) {
  return Number(value) || 0
}

function normalizeInvoiceLineFormat(value) {
  return value === 'BUILDING_SCOPE' ? value : 'LOT_SCOPE'
}

function normalizeSubmissionMethod(value) {
  return ['EMAIL', 'MAIL'].includes(value) ? value : 'PORTAL'
}

function normalizeUtilityBillingMode(value) {
  return value === 'BY_EVENT' ? value : 'FULL'
}

export function toBuilderDrawSchedule(version, draws = [], documents = []) {
  const documentTypes = new Set(
    documents
      .filter((document) => document.is_required)
      .map((document) => document.document_type),
  )
  const submissionMethod = normalizeSubmissionMethod(version.submission_method)
  const submissionDestination = version.submission_destination
    ?? (submissionMethod === 'PORTAL' ? version.portal_name : null)
    ?? ''

  return {
    id: version.id,
    builderId: version.builder_id,
    versionNumber: version.version_number,
    status: version.status,
    draws: draws
      .filter((draw) => draw.setup_version_id === version.id)
      .sort((left, right) => left.draw_number - right.draw_number)
      .map((draw) => ({
        name: draw.name ?? '',
        percentage: toNumber(draw.percentage),
        eventType: draw.event_type,
      })),
    separateHardwarePrice: version.separate_hardware_price,
    utilityBuilding: Boolean(version.utility_building),
    utilityBillingMode: normalizeUtilityBillingMode(version.utility_billing_mode),
    utilityEventPercentages: {
      EXT: toNumber(version.utility_ext_percentage),
      DM: toNumber(version.utility_dm_percentage),
      HW: toNumber(version.utility_hw_percentage),
    },
    optionsBillingDrawIndex: optionalDrawIndex(
      version.options_billing_draw_number,
    ),
    frequency: version.frequency,
    anyDate: Boolean(version.cutoff_any_date),
    cutoffDay: version.cutoff_day,
    cutoffDays: (version.cutoff_days ?? []).map(Number),
    cutoffWeekday: version.cutoff_weekday ?? 0,
    paymentTermsDays: version.payment_terms_days,
    retentionEnabled: version.retention_enabled,
    retentionPercentage: toNumber(version.retention_percentage),
    ocipWrapEnabled: version.wrap_enabled,
    ocipWrapPercentage: toNumber(version.wrap_percentage),
    requiresPo: documentTypes.has('PURCHASE_ORDER'),
    requiresPaymentSchedule: documentTypes.has('PAYMENT_SCHEDULE'),
    requiresRelease: documentTypes.has('RELEASE'),
    requiresBackup: documentTypes.has('BACKUP'),
    invoiceLineFormat: normalizeInvoiceLineFormat(version.invoice_line_format),
    submissionMethod,
    submissionDestination,
    notes: version.notes ?? '',
  }
}

export function toBuilderBillingSetupRpc(schedule) {
  const frequency = schedule.frequency
  const optionsDrawIndex = schedule.optionsBillingDrawIndex
  const submissionMethod = normalizeSubmissionMethod(schedule.submissionMethod)
  const submissionDestination = schedule.submissionDestination.trim() || null

  return {
    p_builder_id: Number(schedule.builderId),
    p_config: {
      separateHardwarePrice: Boolean(schedule.separateHardwarePrice),
      utilityBuilding: Boolean(schedule.utilityBuilding),
      utilityBillingMode: schedule.utilityBuilding
        ? normalizeUtilityBillingMode(schedule.utilityBillingMode)
        : 'FULL',
      utilityExtPercentage: schedule.utilityBuilding
        && schedule.utilityBillingMode === 'BY_EVENT'
        ? Number(schedule.utilityEventPercentages?.EXT) || 0
        : 0,
      utilityDmPercentage: schedule.utilityBuilding
        && schedule.utilityBillingMode === 'BY_EVENT'
        ? Number(schedule.utilityEventPercentages?.DM) || 0
        : 0,
      utilityHwPercentage: schedule.utilityBuilding
        && schedule.utilityBillingMode === 'BY_EVENT'
        ? Number(schedule.utilityEventPercentages?.HW) || 0
        : 0,
      optionsBillingDrawNumber: optionsDrawIndex == null
        ? null
        : Number(optionsDrawIndex) + 1,
      frequency,
      cutoffAnyDate: frequency === 'MONTHLY' && Boolean(schedule.anyDate),
      cutoffDay: frequency === 'MONTHLY' && !schedule.anyDate
        ? Number(schedule.cutoffDay)
        : null,
      cutoffDays: frequency === 'SEMIMONTHLY'
        ? schedule.cutoffDays.map(Number)
        : [],
      cutoffWeekday: frequency === 'WEEKLY'
        ? Number(schedule.cutoffWeekday)
        : null,
      paymentTermsDays: Number(schedule.paymentTermsDays),
      retentionEnabled: Boolean(schedule.retentionEnabled),
      retentionPercentage: schedule.retentionEnabled
        ? Number(schedule.retentionPercentage)
        : 0,
      wrapEnabled: Boolean(schedule.ocipWrapEnabled),
      wrapPercentage: schedule.ocipWrapEnabled
        ? Number(schedule.ocipWrapPercentage)
        : 0,
      invoiceLineFormat: schedule.invoiceLineFormat,
      submissionMethod,
      submissionDestination,
      portalName: submissionMethod === 'PORTAL' ? submissionDestination : null,
      notes: schedule.notes.trim() || null,
    },
    p_draws: schedule.draws.map((draw, index) => ({
      drawNumber: index + 1,
      name: draw.name.trim() || null,
      percentage: Number(draw.percentage),
      eventType: draw.eventType,
    })),
    p_required_documents: requiredDocumentDefinitions
      .filter(({ field }) => schedule[field])
      .map(({ type, label }, index) => ({
        type,
        label,
        required: true,
        displayOrder: index + 1,
      })),
  }
}
