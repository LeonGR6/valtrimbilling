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

export function toDrawInvoicePackage(
  packageRow,
  invoiceRow,
  drawRows = [],
  optionRows = [],
  setupVersion = null,
  corrections = [],
) {
  const sortedDrawRows = [...drawRows].sort(
    (left, right) => left.draw_number - right.draw_number
      || String(left.lot_number).localeCompare(String(right.lot_number), 'en', {
        numeric: true,
        sensitivity: 'base',
      }),
  )
  const drawRowsByLotAndDraw = new Map(
    sortedDrawRows.map((row) => [`${row.lot_id}:${row.draw_id}`, row]),
  )
  const optionsBillingDrawNumber = setupVersion?.options_billing_draw_number

  return {
    id: packageRow.id,
    packageNumber: packageRow.package_number,
    builderId: packageRow.builder_id,
    jobId: packageRow.job_id,
    phaseId: packageRow.phase_id,
    setupVersionId: packageRow.setup_version_id,
    packageDate: packageRow.package_date,
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
      return {
        id: `${row.lot_id}:${row.option_id}`,
        lotId: row.lot_id,
        lotNumber: drawRow?.lot_number ?? '',
        planCode: drawRow?.plan_code ?? null,
        optionId: row.option_id,
        optionCode: row.option_code,
        description: row.option_name,
        price: toNumber(row.option_price),
        issue: null,
      }
    }),
  }
}

export function toCreateDrawPackageRpc({ phaseId, selections }) {
  return {
    p_phase_id: Number(phaseId),
    p_selections: selections.map(({ lotId, drawIndex }) => ({
      lot_id: Number(lotId),
      draw_number: Number(drawIndex) + 1,
    })),
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
