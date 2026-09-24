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

export function toBuilderDrawSchedule(version, draws = [], documents = []) {
  const documentTypes = new Set(
    documents
      .filter((document) => document.is_required)
      .map((document) => document.document_type),
  )

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
      })),
    separateHardwarePrice: version.separate_hardware_price,
    hardwareBillingDrawIndex: optionalDrawIndex(
      version.hardware_billing_draw_number,
    ),
    optionsBillingDrawIndex: optionalDrawIndex(
      version.options_billing_draw_number,
    ),
    frequency: version.frequency,
    cutoffDay: version.cutoff_day ?? 1,
    submissionDay: version.submission_day ?? 1,
    cutoffDays: (version.cutoff_days ?? []).map(Number),
    cutoffWeekday: version.cutoff_weekday ?? 0,
    submissionOffsetDays: version.submission_offset_days ?? 0,
    workAcceptedThrough: version.work_accepted_through,
    invoiceDateRule: version.invoice_date_rule,
    paymentTermsDays: version.payment_terms_days,
    retentionEnabled: version.retention_enabled,
    retentionPercentage: toNumber(version.retention_percentage),
    ocipWrapEnabled: version.wrap_enabled,
    ocipWrapPercentage: toNumber(version.wrap_percentage),
    requiresPo: documentTypes.has('PURCHASE_ORDER'),
    requiresPaymentSchedule: documentTypes.has('PAYMENT_SCHEDULE'),
    requiresRelease: documentTypes.has('RELEASE'),
    requiresBackup: documentTypes.has('BACKUP'),
    invoiceLineFormat: version.invoice_line_format,
    portalName: version.portal_name ?? '',
    notes: version.notes ?? '',
  }
}

export function toBuilderBillingSetupRpc(schedule) {
  const frequency = schedule.frequency
  const optionsDrawIndex = schedule.optionsBillingDrawIndex
  const hardwareDrawIndex = schedule.hardwareBillingDrawIndex

  return {
    p_builder_id: Number(schedule.builderId),
    p_config: {
      separateHardwarePrice: Boolean(schedule.separateHardwarePrice),
      hardwareBillingDrawNumber: schedule.separateHardwarePrice
        && hardwareDrawIndex != null
        ? Number(hardwareDrawIndex) + 1
        : null,
      optionsBillingDrawNumber: optionsDrawIndex == null
        ? null
        : Number(optionsDrawIndex) + 1,
      frequency,
      cutoffDay: frequency === 'MONTHLY' ? Number(schedule.cutoffDay) : null,
      submissionDay: frequency === 'MONTHLY'
        ? Number(schedule.submissionDay)
        : null,
      cutoffDays: frequency === 'SEMIMONTHLY'
        ? schedule.cutoffDays.map(Number)
        : [],
      cutoffWeekday: frequency === 'WEEKLY'
        ? Number(schedule.cutoffWeekday)
        : null,
      submissionOffsetDays: frequency === 'MONTHLY'
        ? null
        : Number(schedule.submissionOffsetDays),
      workAcceptedThrough: schedule.workAcceptedThrough,
      invoiceDateRule: schedule.invoiceDateRule,
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
      portalName: schedule.portalName.trim() || null,
      notes: schedule.notes.trim() || null,
    },
    p_draws: schedule.draws.map((draw, index) => ({
      drawNumber: index + 1,
      name: draw.name.trim() || null,
      percentage: Number(draw.percentage),
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
