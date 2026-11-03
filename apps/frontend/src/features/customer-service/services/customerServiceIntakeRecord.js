import { serviceWorkTypeOptions } from '../data/workTypes.js'
import { serviceKindOptions, getPrototypeServiceTask } from '../utils/newRequestPrototype.js'
import { safeEmailWebLink } from './customerServiceEmailImportRepository.js'

function optionValue(options, value) {
  const key = String(value ?? '').replaceAll('_', ' ').toLowerCase()
  return options.find((option) => option.value.toLowerCase() === key)?.value ?? value ?? ''
}

function numberOrNull(value) {
  return value == null || value === '' ? null : Number(value)
}

function originalEmailReference(receipt) {
  const original = receipt?.source_payload ?? {}
  const text = (value) => typeof value === 'string' ? value : ''
  const graphBody = original.body ?? {}
  const graphIsText = text(graphBody.contentType).toLowerCase() === 'text'
  const bodyText = text(original.bodyText) || (graphIsText ? text(graphBody.content) : '')
  const bodyHtml = text(original.bodyHtml) || (!graphIsText ? text(graphBody.content) : '')
  const attachments = Array.isArray(original.attachments) ? original.attachments : []
  const recipients = (value) => Array.isArray(value) ? value.map((recipient) => {
    const address = recipient?.emailAddress ?? recipient
    return typeof address === 'string' ? address : [text(address?.name), text(address?.address)].filter(Boolean).join(' · ')
  }).filter(Boolean) : []
  return {
    from: text(original.from?.emailAddress?.address) || text(original.from),
    fromName: text(original.from?.emailAddress?.name),
    to: recipients(original.toRecipients),
    cc: recipients(original.ccRecipients),
    sentAt: text(original.sentDateTime) || null,
    receivedAt: text(original.receivedDateTime) || null,
    webLink: safeEmailWebLink(original.webLink),
    subject: text(original.subject),
    body: bodyText || bodyHtml,
    bodyFormat: bodyText ? 'TEXT' : bodyHtml ? 'HTML' : null,
    attachmentNames: attachments.map((attachment) => text(attachment?.name)).filter(Boolean),
    // This is original metadata, not a claim that any file was uploaded.
    attachmentCount: attachments.length,
  }
}

// The database supplies the property snapshot and all persisted content. Never
// rebuild a saved request from form values: idempotent replays may be older.
export function toCustomerServiceIntakeRecord(record) {
  const row = record.request
  const property = record.property
  const source = record.source
  const emailImport = record.emailImport
  const importedEmail = emailImport ? originalEmailReference(emailImport) : null
  const file = source?.file
  const primary = record.contacts.find((contact) => contact.role === 'PRIMARY')
  const items = record.items.map((item) => ({
    id: String(item.id),
    itemNumber: String(item.item_number),
    description: item.description,
    materialRequired: item.material_required,
    chargeable: item.chargeable,
  }))
  const description = items.length
    ? items.map((item) => item.description).join('\n')
    : row.description ?? ''
  const extraction = source && (source.extraction_payload || source.extracted_text)
    ? {
      sourceType: source.source_type,
      text: source.extracted_text ?? '',
      structuredData: source.extraction_payload,
      model: source.extraction_model,
      pages: [],
    }
    : emailImport?.extraction_payload ? {
      sourceType: 'EMAIL_TEXT',
      text: '',
      structuredData: emailImport.extraction_payload,
      model: null,
      pages: [],
    } : null

  return {
    id: row.id,
    requestNumber: row.folio,
    submissionKey: row.submission_key,
    emailImportId: row.email_import_id ?? emailImport?.id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    coordinatorName: record.coordinatorName ?? '',
    reportedAt: row.reported_on,
    reportedAtSource: row.reported_on_source,
    dueOn: row.due_on,
    priority: row.priority,
    workflowStage: row.workflow_stage,
    builderName: record.builderName ?? '',
    jobId: property.job_id == null ? '' : String(property.job_id),
    jobCode: record.jobCode ?? '',
    community: record.community ?? '',
    lotNumber: property.lot_number ?? '',
    address: property.address ?? '',
    latitude: numberOrNull(property.latitude),
    longitude: numberOrNull(property.longitude),
    contactName: primary?.name ?? row.homeowner_name ?? '',
    contactEmail: primary?.email ?? row.homeowner_email ?? '',
    contactPhone: primary?.phone ?? row.homeowner_phone ?? '',
    additionalContacts: record.contacts.filter((contact) => contact.role === 'ADDITIONAL')
      .map((contact) => ({ name: contact.name, email: contact.email ?? '', phone: contact.phone ?? '' })),
    serviceKind: optionValue(serviceKindOptions, row.service_kind),
    workType: optionValue(serviceWorkTypeOptions, row.work_category),
    serviceTask: row.service_task ?? '',
    estimatedDurationMinutes: row.estimated_duration_minutes ?? '',
    crewSize: row.crew_size ?? '',
    requestedWorkItems: items,
    description,
    issue: getPrototypeServiceTask(row.service_task)?.label ?? description.slice(0, 140),
    internalNotes: row.internal_notes ?? '',
    review: row.reviewed_at ? {
      completedAt: row.reviewed_at,
      completedBy: record.reviewerName ?? '',
      valtrimItemsConfirmed: row.valtrim_items_confirmed,
    } : null,
    extractionReviewNotes: source?.review_notes ?? [],
    sourceEmail: importedEmail ?? (source ? {
      from: source?.sender_email ?? '',
      subject: source?.subject ?? '',
      body: source?.email_text ?? '',
      attachmentNames: file ? [file.original_filename] : [],
      attachmentCount: source?.source_type === 'PDF' ? 1 : 0,
    } : { from: '', subject: '', body: '', attachmentNames: [], attachmentCount: 0 }),
    sourceDocument: source && source.source_type !== 'EMAIL_METADATA' ? {
      persisted: true,
      sourceType: source.source_type,
      ...(source.recovery_pdf_sha256 && { recoveryPdf: {
        sha256: source.recovery_pdf_sha256, sizeBytes: Number(source.recovery_pdf_size_bytes),
        originalFilename: source.recovery_pdf_filename,
      } }),
      extraction,
      fileStatus: source.file_status,
      fileError: source.file_error,
      storage: file ? {
        requestId: row.id,
        fileId: file.id,
        fileStatus: source.file_status,
        bucketId: file.bucket_id,
        objectPath: file.object_path,
        originalFilename: file.original_filename,
      } : null,
    } : emailImport && (importedEmail?.body || extraction) ? {
      persisted: true,
      sourceType: 'EMAIL_TEXT',
      extraction,
      fileStatus: 'NOT_APPLICABLE',
      fileError: null,
      storage: null,
    } : null,
    activity: record.workflowHistory.map((history) => ({
      id: history.id,
      label: history.previous_stage ? 'Request stage changed' : 'Request created',
      detail: history.note || history.new_stage.replaceAll('_', ' '),
      at: history.changed_at,
    })),
    customerWindow: null,
    technicianName: '',
    confirmationStatus: 'Not sent',
    customerUnavailableDates: row.customer_unavailable_dates ?? [],
    customerNeedsContact: Boolean(row.customer_needs_contact),
    customerAvailabilityNotes: row.customer_availability_notes ?? '',
    prototypeOnly: false,
  }
}
