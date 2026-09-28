export const DRAW_PACKAGE_STATUSES = [
  'DRAFT',
  'READY_TO_SUBMIT',
  'AWAITING_PAYMENT',
  'PAID_CLOSED',
]

export const DRAW_PACKAGE_STATUS_LABELS = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready to submit',
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
  if (!date || !setupVersion) return null

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
  const phaseIds = uniqueSortedNumbers(
    sortedDrawRows.map((row) => row.phase_id),
  )
  const primaryPhaseId = packageRow.phase_id ?? phaseIds[0] ?? null

  return {
    id: packageRow.id,
    packageNumber: packageRow.package_number,
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
    billingPeriodStart: packageRow.billing_period_start,
    billingPeriodEnd: packageRow.billing_period_end,
    paymentTermsDays: packageRow.payment_terms_days,
    invoiceLineFormat: packageRow.invoice_line_format,
    portalName: packageRow.portal_name ?? '',
    quickbooksStatus: packageRow.quickbooks_status ?? 'NOT_CREATED',
    quickbooksReference: packageRow.quickbooks_reference ?? null,
    submissionStatus: packageRow.submission_status ?? 'NOT_SUBMITTED',
    submittedAt: packageRow.submitted_at ?? null,
    status: packageRow.status === 'VOIDED'
      ? 'CANCELLED'
      : packageRow.workflow_status,
    cancelledAt: packageRow.voided_at ?? null,
    cancellationReason: packageRow.void_reason ?? null,
    corrections,
    notes: packageRow.notes ?? '',
    statusChangedAt: packageRow.status_changed_at,
    statusChangedBy: packageRow.status_changed_by,
    createdAt: packageRow.created_at,
    updatedAt: packageRow.updated_at,
    lotIds: uniqueSortedNumbers(sortedDrawRows.map((row) => row.lot_id)),
    drawIndexes: uniqueSortedNumbers(
      sortedDrawRows.map((row) => Number(row.draw_number) - 1),
    ),
    selections: sortedDrawRows.map((row) => ({
      phaseId: row.phase_id,
      lotId: row.lot_id,
      drawIndex: Number(row.draw_number) - 1,
    })),
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
      planCode: row.plan_code,
      drawIndex: Number(row.draw_number) - 1,
      drawName: row.draw_name ?? '',
      baseDrawAmount: toNumber(row.base_draw_amount),
      hardwareAmount: toNumber(row.hardware_amount),
      optionsAmount: toNumber(row.options_amount),
      grossAmount: toNumber(row.gross_amount),
      retentionAmount: toNumber(row.retention_amount),
      wrapAmount: toNumber(row.wrap_amount),
      netAmount: toNumber(row.net_amount),
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

  return {
    p_job_id: Number(jobId),
    p_selections: selections.map(({ lotId, drawIndex }, index) => {
      const selection = {
        lot_id: Number(lotId),
        draw_number: Number(drawIndex) + 1,
      }

      if (
        hasExplicitOptionSelection
        && index === anchorIndex
      ) {
        selection.package_options = sortedPackageOptions
      }

      return selection
    }),
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

function toSelectionRecords(selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('Select at least one Lot / Draw cell.')
  }
  return selections.map(({ lotId, drawIndex }) => ({
    lot_id: Number(lotId),
    draw_number: Number(drawIndex) + 1,
  }))
}

export function canCorrectDrawPackage(record) {
  return record != null
    && ['DRAFT', 'READY_TO_SUBMIT'].includes(record.status)
    && record.persistedInvoice?.status === 'DRAFT'
    && !record.invoiceNumber
    && !record.invoiceDate
    && record.persistedInvoice.paidAmount === 0
    && record.quickbooksStatus === 'NOT_CREATED'
    && !record.quickbooksReference
    && record.submissionStatus === 'NOT_SUBMITTED'
    && !record.submittedAt
}

export function toEditDrawPackageRpc({
  packageId,
  selections,
  reason,
  billingPeriodStart,
  billingPeriodEnd,
  notes,
}) {
  return {
    p_package_id: Number(packageId),
    p_selections: toSelectionRecords(selections),
    p_reason: String(reason ?? '').trim(),
    p_period_start: billingPeriodStart || null,
    p_period_end: billingPeriodEnd || null,
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
