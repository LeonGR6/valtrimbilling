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
    status: packageRow.workflow_status,
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

export function toCreateDrawPackageRpc({ phaseId, lotIds, drawIndexes }) {
  return {
    p_phase_id: Number(phaseId),
    p_lot_ids: lotIds.map(Number),
    p_draw_numbers: drawIndexes.map((drawIndex) => Number(drawIndex) + 1),
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
