/**
 * One open QuickBooks invoice, from a Package row and the QuickBooks reading
 * embedded in it (see receivablesRepository.js). The balance and the Due Date are
 * QuickBooks' own: the Due Date was worked out once from the Builder's Payment
 * Terms when the invoice was created, and is not worked out again here.
 */
export function toReceivableRecord(row) {
  const sync = row.quickbooks_invoice_syncs ?? {}
  const original = sync.qbo_total ?? sync.total_amount

  return {
    packageId: row.id,
    packageNumber: row.package_number,
    packageType: row.package_type,
    builderId: row.builder_id,
    jobId: row.job_id,
    phaseId: row.phase_id,
    workflowStatus: row.workflow_status,
    invoiceNumber: sync.qbo_doc_number ?? row.quickbooks_reference ?? null,
    invoiceDate: sync.qbo_invoice_date ?? null,
    dueDate: sync.qbo_due_date ?? null,
    originalAmount: original == null ? null : Number(original),
    balance: sync.qbo_balance == null ? null : Number(sync.qbo_balance),
    paymentState: sync.qbo_state ?? null,
    checkedAt: sync.qbo_state_checked_at ?? null,
  }
}
