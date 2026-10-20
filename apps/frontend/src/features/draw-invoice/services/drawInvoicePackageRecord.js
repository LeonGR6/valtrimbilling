// A Package is a Draft until it is submitted, then it waits for payment.
export const DRAW_PACKAGE_STATUSES = [
  'DRAFT',
  'AWAITING_PAYMENT',
  'PAID_CLOSED',
]

export const DRAW_PACKAGE_STATUS_LABELS = {
  DRAFT: 'Draft',
  AWAITING_PAYMENT: 'Awaiting payment',
  PAID_CLOSED: 'Paid / Closed',
  CANCELLED: 'Cancelled',
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))]
    .sort((left, right) => left - right)
}

function getDrawEventType(drawRow) {
  return drawRow.event_type ?? null
}

function utilityLabel(lotNumber) {
  const match = /^UTILITY-(\d+)$/i.exec(String(lotNumber ?? ''))
  return match ? `Utility ${match[1]}` : 'Utility Building'
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText) - 1
  const day = Number(dayText)
  const date = new Date(year, month, day)

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month
    || date.getDate() !== day
  ) return null

  return date
}

function dateOnMonthDay(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay))
}

function toDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveBillingCutoffDate(packageDate, setupVersion) {
  const date = parseDateKey(packageDate)
  if (!date || !setupVersion || setupVersion.cutoff_any_date) return null

  if (setupVersion.frequency === 'MONTHLY') {
    const cutoffDay = Number(setupVersion.cutoff_day)
    if (!Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 31) return null

    let cutoffDate = dateOnMonthDay(
      date.getFullYear(),
      date.getMonth(),
      cutoffDay,
    )
    if (cutoffDate < date) {
      cutoffDate = dateOnMonthDay(
        date.getFullYear(),
        date.getMonth() + 1,
        cutoffDay,
      )
    }
    return toDateKey(cutoffDate)
  }

  if (setupVersion.frequency === 'SEMIMONTHLY') {
    const cutoffDays = [...new Set((setupVersion.cutoff_days ?? [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31))]
      .sort((left, right) => left - right)

    for (let monthOffset = 0; monthOffset <= 1; monthOffset += 1) {
      const candidates = cutoffDays
        .map((day) => dateOnMonthDay(
          date.getFullYear(),
          date.getMonth() + monthOffset,
          day,
        ))
        .sort((left, right) => left - right)
      const cutoffDate = candidates.find((candidate) => candidate >= date)
      if (cutoffDate) return toDateKey(cutoffDate)
    }
    return null
  }

  if (setupVersion.frequency === 'WEEKLY') {
    const cutoffWeekday = Number(setupVersion.cutoff_weekday)
    if (!Number.isInteger(cutoffWeekday) || cutoffWeekday < 0 || cutoffWeekday > 6) {
      return null
    }

    const cutoffDate = new Date(date)
    const daysUntilCutoff = (cutoffWeekday - date.getDay() + 7) % 7
    cutoffDate.setDate(cutoffDate.getDate() + daysUntilCutoff)
    return toDateKey(cutoffDate)
  }

  return null
}

export function toDrawInvoicePackage(
  packageRow,
  invoiceRow,
  drawRows = [],
  optionRows = [],
  setupVersion = null,
  corrections = [],
  retentionReleaseRow = null,
  retentionReleaseLineRows = [],
  hardwareRows = [],
  retentionReleaseHardwareLineRows = [],
  priceAdjustmentRow = null,
  priceAdjustmentLineRows = [],
  retentionReleaseAdjustmentLineRows = [],
) {
  const sortedDrawRows = [...drawRows].sort(
    (left, right) => String(left.phase_code ?? '').localeCompare(
      String(right.phase_code ?? ''),
      'en',
      { numeric: true, sensitivity: 'base' },
    )
      || left.draw_number - right.draw_number
      || String(left.lot_number).localeCompare(String(right.lot_number), 'en', {
        numeric: true,
        sensitivity: 'base',
      }),
  )
  const drawRowsByLotAndDraw = new Map(
    sortedDrawRows.map((row) => [`${row.lot_id}:${row.draw_id}`, row]),
  )
  const optionsBillingDrawNumber = setupVersion?.options_billing_draw_number
  const sortedHardwareRows = [...hardwareRows].sort(
    (left, right) => String(left.phase_code ?? '').localeCompare(
      String(right.phase_code ?? ''),
      'en',
      { numeric: true, sensitivity: 'base' },
    )
      || String(left.lot_number).localeCompare(String(right.lot_number), 'en', {
        numeric: true,
        sensitivity: 'base',
      })
      || String(left.hardware_event_type ?? '').localeCompare(
        String(right.hardware_event_type ?? ''),
      ),
  )
  const phaseIds = uniqueSortedNumbers([
    ...sortedDrawRows.map((row) => row.phase_id),
    ...sortedHardwareRows.map((row) => row.phase_id),
  ])
  const primaryPhaseId = packageRow.phase_id ?? phaseIds[0] ?? null
  const submissionMethod = ['EMAIL', 'MAIL'].includes(
    setupVersion?.submission_method,
  )
    ? setupVersion.submission_method
    : 'PORTAL'
  const submissionDestination = setupVersion?.submission_destination
    ?? (submissionMethod === 'PORTAL' ? setupVersion?.portal_name : null)
    ?? ''

  return {
    id: packageRow.id,
    packageNumber: packageRow.package_number,
    packageType: ['RETENTION_RELEASE', 'PRICE_ADJUSTMENT'].includes(packageRow.package_type)
      ? packageRow.package_type
      : 'DRAW',
    builderId: packageRow.builder_id,
    jobId: packageRow.job_id,
    phaseId: primaryPhaseId,
    phaseIds,
    setupVersionId: packageRow.setup_version_id,
    packageDate: packageRow.package_date,
    billingCutoffDate: resolveBillingCutoffDate(
      packageRow.package_date,
      setupVersion,
    ),
    billingCutoffAnyDate: Boolean(setupVersion?.cutoff_any_date),
    paymentTermsDays: setupVersion?.payment_terms_days ?? null,
    invoiceLineFormat: packageRow.invoice_line_format,
    submissionMethod,
    submissionDestination,
    portalName: submissionMethod === 'PORTAL' ? submissionDestination : '',
    quickbooksStatus: packageRow.quickbooks_status ?? 'NOT_CREATED',
    quickbooksReference: packageRow.quickbooks_reference ?? null,
    paymentState: packageRow.quickbooks_invoice_syncs?.qbo_state ?? null,
    paymentOverdue: Boolean(packageRow.quickbooks_invoice_syncs?.qbo_overdue),
    submissionStatus: packageRow.submission_status ?? 'NOT_SUBMITTED',
    submittedAt: packageRow.submitted_at ?? null,
    // "Ready to submit" no longer exists: a Package still stored in it is a Draft.
    status: packageRow.status === 'VOIDED'
      ? 'CANCELLED'
      : packageRow.workflow_status === 'READY_TO_SUBMIT' ? 'DRAFT' : packageRow.workflow_status,
    cancelledAt: packageRow.voided_at ?? null,
    cancellationReason: packageRow.void_reason ?? null,
    corrections,
    notes: packageRow.notes ?? '',
    statusChangedAt: packageRow.status_changed_at,
    statusChangedBy: packageRow.status_changed_by,
    createdAt: packageRow.created_at,
    updatedAt: packageRow.updated_at,
    retentionRelease: retentionReleaseRow
      ? {
          scopeType: retentionReleaseRow.scope_type,
          phaseId: retentionReleaseRow.phase_id,
          phaseCode: retentionReleaseRow.phase_code,
          building: retentionReleaseRow.building,
          sourceCutoffDate: retentionReleaseRow.source_cutoff_date,
          availableDate: retentionReleaseRow.available_date,
          retainedAmount: toNumber(retentionReleaseRow.retained_amount),
          sourceLines: retentionReleaseLineRows.map((row) => ({
            sourcePackageId: row.source_package_id,
            sourceLotId: row.source_lot_id,
            sourceDrawId: row.source_draw_id,
            phaseId: row.phase_id,
            retentionAmount: toNumber(row.retention_amount),
          })),
          // What Price Adjustments retained; a credit makes it negative.
          sourceAdjustmentLines: retentionReleaseAdjustmentLineRows.map((row) => ({
            sourceAdjustmentLineId: row.source_adjustment_line_id,
            sourcePackageId: row.source_package_id,
            phaseId: row.phase_id,
            retentionAmount: toNumber(row.retention_amount),
          })),
          sourceHardwareLines: retentionReleaseHardwareLineRows.map((row) => ({
            sourceHardwareLineId: row.source_hardware_line_id,
            sourcePackageId: row.source_package_id,
            sourceLotId: row.source_lot_id,
            hardwareEventType: row.hardware_event_type,
            phaseId: row.phase_id,
            retentionAmount: toNumber(row.retention_amount),
          })),
        }
      : null,
    // The price differences of issued Packages that this Package invoices.
    priceAdjustment: priceAdjustmentRow
      ? {
          sourcePackageCount: Number(priceAdjustmentRow.source_package_count),
          lineCount: Number(priceAdjustmentRow.line_count),
          grossAmount: toNumber(priceAdjustmentRow.gross_amount),
          retentionAmount: toNumber(priceAdjustmentRow.retention_amount),
          wrapAmount: toNumber(priceAdjustmentRow.wrap_amount),
          netAmount: toNumber(priceAdjustmentRow.net_amount),
          lines: priceAdjustmentLineRows.map((row) => ({
            id: row.id,
            sourcePackageId: row.source_package_id,
            sourcePackageNumber: row.source_package_number,
            kind: row.line_kind,
            lotId: row.lot_id,
            lotNumber: row.lot_number,
            phaseId: row.phase_id,
            phaseCode: row.phase_code,
            building: row.building ?? '',
            planCode: row.plan_code,
            drawNumber: row.draw_number == null ? null : Number(row.draw_number),
            hardwareEventType: row.hardware_event_type ?? null,
            base: toNumber(row.delta_base),
            hardware: toNumber(row.delta_hardware),
            utility: toNumber(row.delta_utility),
            options: toNumber(row.delta_options),
            gross: toNumber(row.gross),
            retention: toNumber(row.retention),
            wrap: toNumber(row.wrap),
            net: toNumber(row.net),
          })),
        }
      : null,
    lotIds: uniqueSortedNumbers([
      ...sortedDrawRows.map((row) => row.lot_id),
      ...sortedHardwareRows.map((row) => row.lot_id),
    ]),
    drawIndexes: uniqueSortedNumbers(
      sortedDrawRows.map((row) => Number(row.draw_number) - 1),
    ),
    selections: sortedDrawRows.map((row) => ({
      phaseId: row.phase_id,
      lotId: row.lot_id,
      drawIndex: Number(row.draw_number) - 1,
      chargeHardware: toNumber(row.hardware_percentage) > 0
        || toNumber(row.hardware_amount) > 0,
    })),
    separateHardwarePrice: Boolean(setupVersion?.separate_hardware_price),
    hardwareBillingMode: setupVersion?.hardware_billing_mode === 'BY_EVENT'
      ? 'BY_EVENT'
      : 'FULL',
    hardwareEventPercentages: {
      EXT: toNumber(setupVersion?.hardware_ext_percentage),
      DM: toNumber(setupVersion?.hardware_dm_percentage),
      HW: toNumber(setupVersion?.hardware_hw_percentage),
    },
    utilityBuilding: Boolean(setupVersion?.utility_building),
    utilityBillingMode: setupVersion?.utility_billing_mode === 'BY_EVENT'
      ? 'BY_EVENT'
      : 'FULL',
    utilityEventPercentages: {
      EXT: toNumber(setupVersion?.utility_ext_percentage),
      DM: toNumber(setupVersion?.utility_dm_percentage),
      HW: toNumber(setupVersion?.utility_hw_percentage),
    },
    optionsBillingDrawIndex: optionsBillingDrawNumber == null
      ? null
      : Number(optionsBillingDrawNumber) - 1,
    invoiceNumber: invoiceRow?.invoice_number ?? null,
    invoiceDate: invoiceRow?.invoice_date ?? null,
    dueDate: invoiceRow?.due_date ?? null,
    persistedInvoice: invoiceRow
      ? {
          id: invoiceRow.id,
          status: invoiceRow.status,
          grossAmount: toNumber(invoiceRow.gross_amount),
          retentionAmount: toNumber(invoiceRow.retention_amount),
          wrapAmount: toNumber(invoiceRow.wrap_amount),
          netAmount: toNumber(invoiceRow.net_amount),
          paidAmount: toNumber(invoiceRow.paid_amount),
        }
      : null,
    persistedDrawLines: sortedDrawRows.map((row) => ({
      phaseId: row.phase_id,
      phaseCode: row.phase_code,
      building: row.building,
      lotId: row.lot_id,
      drawId: row.draw_id,
      lotNumber: row.lot_number,
      utilityLabel: row.is_utility_building
        ? row.utility_name?.trim() || utilityLabel(row.lot_number)
        : null,
      isUtilityBuilding: Boolean(row.is_utility_building),
      planCode: row.plan_code,
      basePrice: toNumber(row.base_price),
      drawIndex: Number(row.draw_number) - 1,
      drawName: row.draw_name ?? '',
      eventType: getDrawEventType(row),
      baseDrawAmount: toNumber(row.base_draw_amount),
      hardwareAmount: toNumber(row.hardware_amount),
      hardwareBillingMode: row.hardware_billing_mode === 'BY_EVENT'
        ? 'BY_EVENT'
        : 'FULL',
      hardwareEventType: row.hardware_event_type ?? null,
      hardwarePercentage: toNumber(row.hardware_percentage),
      optionsAmount: toNumber(row.options_amount),
      utilityAmount: toNumber(row.utility_amount),
      utilityBillingMode: row.utility_billing_mode === 'BY_EVENT'
        ? 'BY_EVENT'
        : 'FULL',
      utilityEventType: row.utility_event_type ?? null,
      utilityPercentage: toNumber(row.utility_percentage),
      grossAmount: toNumber(row.gross_amount),
      retentionAmount: toNumber(row.retention_amount),
      wrapAmount: toNumber(row.wrap_amount),
      netAmount: toNumber(row.net_amount),
    })),
    persistedHardwareLines: sortedHardwareRows.map((row) => ({
      id: row.id,
      packageId: row.package_id,
      phaseId: row.phase_id,
      phaseCode: row.phase_code,
      building: row.building,
      lotId: row.lot_id,
      lotNumber: row.lot_number,
      planCode: row.plan_code,
      hardwarePrice: toNumber(row.hardware_price),
      hardwareBillingMode: 'BY_EVENT',
      hardwareEventType: row.hardware_event_type,
      eventType: row.hardware_event_type,
      hardwarePercentage: toNumber(row.hardware_percentage),
      hardwareAmount: toNumber(row.hardware_amount),
      grossAmount: toNumber(row.gross_amount),
      retentionAmount: toNumber(row.retention_amount),
      wrapAmount: toNumber(row.wrap_amount),
      netAmount: toNumber(row.net_amount),
      drawIndex: null,
      drawName: '',
      isUtilityBuilding: false,
    })),
    persistedOptionLines: optionRows.map((row) => {
      const drawRow = drawRowsByLotAndDraw.get(`${row.lot_id}:${row.draw_id}`)
      const billingDrawRow = drawRowsByLotAndDraw.get(
        `${row.billing_lot_id ?? row.lot_id}:${row.draw_id}`,
      )
      const hasOriginSnapshot = row.phase_id != null
      return {
        id: `${row.lot_id}:${row.option_id}`,
        phaseId: row.phase_id ?? drawRow?.phase_id ?? null,
        phaseCode: row.phase_code ?? drawRow?.phase_code ?? null,
        building: hasOriginSnapshot ? row.building : (drawRow?.building ?? null),
        lotId: row.lot_id,
        lotNumber: row.lot_number ?? drawRow?.lot_number ?? '',
        planCode: row.plan_code ?? drawRow?.plan_code ?? null,
        optionId: row.option_id,
        optionCode: row.option_code,
        description: row.option_name,
        price: toNumber(row.option_price),
        priceNotApplicable: row.option_not_applicable === true,
        billingDrawIndex: billingDrawRow == null
          ? null
          : Number(billingDrawRow.draw_number) - 1,
        issue: null,
      }
    }),
  }
}

export function toCreateDrawPackageRpc({
  jobId,
  selections,
  hardwareSelections = [],
  optionSelections,
  optionsBillingDrawIndex,
}) {
  const parsedOptionsBillingDrawIndex = Number(optionsBillingDrawIndex)
  const hasExplicitOptionSelection = Array.isArray(optionSelections)
    && optionsBillingDrawIndex !== null
    && optionsBillingDrawIndex !== ''
    && Number.isInteger(parsedOptionsBillingDrawIndex)
  const packageOptions = new Map()

  if (hasExplicitOptionSelection) {
    for (const { lotId, optionId } of optionSelections) {
      const normalized = {
        lot_id: Number(lotId),
        option_id: Number(optionId),
      }
      packageOptions.set(
        `${normalized.lot_id}:${normalized.option_id}`,
        normalized,
      )
    }
  }

  const anchorIndex = hasExplicitOptionSelection
    ? selections
        .map(({ drawIndex }, index) => ({
          drawIndex: Number(drawIndex),
          index,
        }))
        .filter(({ drawIndex }) => drawIndex >= parsedOptionsBillingDrawIndex)
        .sort((left, right) => (
          left.drawIndex - right.drawIndex || left.index - right.index
        ))[0]?.index ?? -1
    : -1
  const sortedPackageOptions = [...packageOptions.values()].sort(
    (left, right) => left.lot_id - right.lot_id || left.option_id - right.option_id,
  )
  const legacyHardwareKeys = new Set(hardwareSelections
    .filter(({ eventType }) => eventType == null)
    .map(({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`))
  const eventHardwareSelections = [...new Map(hardwareSelections
    .filter(({ eventType }) => eventType != null)
    .map(({ lotId, eventType }) => {
      const normalized = {
        lot_id: Number(lotId),
        event_type: String(eventType),
      }
      return [`${normalized.lot_id}:${normalized.event_type}`, normalized]
    })).values()].sort((left, right) => (
    left.lot_id - right.lot_id
      || left.event_type.localeCompare(right.event_type)
  ))

  return {
    p_job_id: Number(jobId),
    p_selections: selections.map(({ phaseId, lotId, drawIndex }, index) => {
      const selection = {
        lot_id: Number(lotId),
        draw_number: Number(drawIndex) + 1,
      }

      if (legacyHardwareKeys.has(`${phaseId}:${lotId}:${drawIndex}`)) {
        selection.charge_hardware = true
      }

      if (
        hasExplicitOptionSelection
        && index === anchorIndex
      ) {
        selection.package_options = sortedPackageOptions
      }

      return selection
    }),
    ...(eventHardwareSelections.length > 0
      ? { p_hardware_selections: eventHardwareSelections }
      : {}),
  }
}

export function toPackageStatusRpc(packageId, status) {
  if (!DRAW_PACKAGE_STATUSES.includes(status)) {
    throw new Error('Select a valid Package status.')
  }

  return {
    p_package_id: Number(packageId),
    p_status: status,
  }
}

export function toCreateRetentionReleasePackageRpc({
  jobId,
  phaseId = null,
  notes = null,
}) {
  return {
    p_job_id: Number(jobId),
    p_phase_id: phaseId == null ? null : Number(phaseId),
    p_notes: String(notes ?? '').trim() || null,
  }
}

export function toCreatePriceAdjustmentPackageRpc({
  jobId,
  sourcePackageIds,
  notes = null,
}) {
  const ids = [...new Set((sourcePackageIds ?? []).map(Number).filter(Number.isFinite))]
  if (ids.length === 0) {
    throw new Error('Select at least one Package with a pending price difference.')
  }
  return {
    p_job_id: Number(jobId),
    p_source_package_ids: ids,
    p_notes: String(notes ?? '').trim() || null,
  }
}

function toSelectionRecords(selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('Select at least one Lot / Draw cell.')
  }
  return selections.map(({ lotId, drawIndex, chargeHardware }) => ({
    lot_id: Number(lotId),
    draw_number: Number(drawIndex) + 1,
    charge_hardware: Boolean(chargeHardware),
  }))
}

export function canManageDraftDrawPackage(record) {
  return record != null
    && record.packageType === 'DRAW'
    && record.status === 'DRAFT'
    && record.persistedInvoice?.status === 'DRAFT'
    && !record.invoiceNumber
    && !record.invoiceDate
    && record.persistedInvoice.paidAmount === 0
    && record.quickbooksStatus === 'NOT_CREATED'
    && !record.quickbooksReference
    && record.submissionStatus === 'NOT_SUBMITTED'
    && !record.submittedAt
}

/**
 * A draft whose QuickBooks invoice was voided can still be deleted, but not
 * edited: the invoice number stays in QuickBooks, so its cells are not reused.
 */
export function canDeleteVoidedQuickbooksPackage(record) {
  return record != null
    && ['DRAW', 'PRICE_ADJUSTMENT'].includes(record.packageType)
    && record.status === 'DRAFT'
    && record.quickbooksStatus === 'VOIDED'
    && record.persistedInvoice?.status === 'DRAFT'
    && !record.invoiceNumber
    && !record.invoiceDate
    && record.persistedInvoice.paidAmount === 0
    && record.submissionStatus === 'NOT_SUBMITTED'
    && !record.submittedAt
}

/**
 * Why a Draft Package can no longer be edited, moved or deleted, in the words
 * shown to the person; null when the Package is not a locked Draft.
 */
export function draftLockReason(record) {
  if (record == null || record.status !== 'DRAFT' || canManageDraftDrawPackage(record)) {
    return null
  }
  if (record.packageType === 'RETENTION_RELEASE') {
    return 'A Retention Release cannot be edited. Cancel it from the Packages list if it was created by mistake.'
  }
  if (record.packageType === 'PRICE_ADJUSTMENT') {
    return 'A Price Adjustment cannot be edited. Cancel it from the Packages list to give its differences back.'
  }
  if (record.submissionStatus !== 'NOT_SUBMITTED' || record.submittedAt) {
    return 'This Package was already sent to the Builder, so its cells are locked.'
  }
  if (record.quickbooksStatus === 'CREATED') {
    return 'This Package already has a QuickBooks invoice, so its cells are locked.'
  }
  if (record.quickbooksStatus === 'VOIDED') {
    return 'The QuickBooks invoice was voided. The Package can be deleted but not edited.'
  }
  if (record.invoiceNumber || record.invoiceDate || record.quickbooksReference) {
    return 'This Package already has an invoice number, so its cells are locked.'
  }
  if (record.persistedInvoice?.paidAmount > 0) {
    return 'This Package has a payment recorded, so its cells are locked.'
  }
  return 'This Package can no longer be changed.'
}

export function canCorrectDrawPackage(record) {
  return canManageDraftDrawPackage(record)
    && (record.persistedHardwareLines?.length ?? 0) === 0
}

export function toEditDrawPackageRpc({
  packageId,
  selections,
  reason,
  notes,
}) {
  return {
    p_package_id: Number(packageId),
    p_selections: toSelectionRecords(selections),
    p_reason: String(reason ?? '').trim(),
    p_notes: String(notes ?? '').trim() || null,
  }
}

export function toTransferDrawPackageRpc({
  toPackageId,
  fromPackageId,
  selections,
  reason,
}) {
  return {
    p_to_package_id: Number(toPackageId),
    p_from_package_id: Number(fromPackageId),
    p_selections: toSelectionRecords(selections),
    p_reason: String(reason ?? '').trim(),
  }
}

export function toCancelDrawPackageRpc(packageId, reason) {
  return {
    p_package_id: Number(packageId),
    p_reason: String(reason ?? '').trim(),
  }
}
