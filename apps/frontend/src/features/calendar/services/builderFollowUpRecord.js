const DELIVERY_STATUSES = new Set([
  'UPCOMING',
  'DUE',
  'OVERDUE',
  'PROCESSING',
  'FAILED',
  'SENT',
  'COMPLETED',
  'SKIPPED',
  'CANCELLED',
])

const ESCALATION_DELIVERY_STATUSES = new Set([
  'PENDING',
  'DUE',
  'OVERDUE',
  'PROCESSING',
  'FAILED',
  'SENT',
  'CANCELLED',
  'DISABLED',
])

function requiredString(value, field) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`Builder follow-up ${field} is missing.`)
  return normalized
}

export function toBuilderFollowUpItem(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('Builder follow-up row is invalid.')
  }
  const deliveryStatus = requiredString(row.delivery_status, 'delivery status')
  if (!DELIVERY_STATUSES.has(deliveryStatus)) {
    throw new Error('Builder follow-up delivery status is invalid.')
  }

  return {
    checkpointId: requiredString(row.checkpoint_id, 'checkpoint id'),
    scheduleId: requiredString(row.schedule_id, 'schedule id'),
    checkpointCode: requiredString(row.checkpoint_code, 'checkpoint code'),
    daysBefore: Number(row.days_before),
    stageType: requiredString(row.stage_type, 'stage type'),
    variant: requiredString(row.variant, 'variant'),
    workDate: requiredString(row.work_date, 'work date'),
    dueOn: requiredString(row.due_on, 'due date'),
    checkpointStatus: requiredString(row.checkpoint_status, 'checkpoint status'),
    followUpStatus: requiredString(row.follow_up_status, 'follow-up status'),
    jobCode: requiredString(row.job_code, 'Job code'),
    community: String(row.community ?? '').trim(),
    builderName: requiredString(row.builder_name, 'Builder'),
    phaseCode: requiredString(row.phase_code, 'Phase'),
    building: String(row.building ?? '').trim(),
    lotStartLabel: String(row.lot_start_label ?? '').trim(),
    lotEndLabel: String(row.lot_end_label ?? '').trim(),
    recipientContactId: requiredString(row.recipient_contact_id, 'recipient id'),
    recipientName: requiredString(row.recipient_name, 'recipient name'),
    recipientEmail: requiredString(row.recipient_email, 'recipient email'),
    recipientIsActive: Boolean(row.recipient_is_active),
    emailStatus: row.email_status ? String(row.email_status) : null,
    sentAt: row.sent_at ?? null,
    lastError: row.last_error ?? null,
    deliveryStatus,
    daysUntilDue: Number(row.days_until_due),
    confirmedAt: row.confirmed_at ?? null,
    lastResponseAt: row.last_response_at ?? null,
  }
}

export function toBuilderFollowUpAttentionItem(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('Builder follow-up attention row is invalid.')
  }
  const deliveryStatus = requiredString(row.delivery_status, 'escalation delivery status')
  if (!ESCALATION_DELIVERY_STATUSES.has(deliveryStatus)) {
    throw new Error('Builder follow-up escalation delivery status is invalid.')
  }

  const recipientEmails = Array.isArray(row.recipient_emails)
    ? row.recipient_emails.map((email) => requiredString(email, 'escalation recipient'))
    : []
  if (recipientEmails.length === 0) {
    throw new Error('Builder follow-up escalation recipients are missing.')
  }

  return {
    escalationId: row.escalation_id ? String(row.escalation_id) : null,
    noResponseEventId: requiredString(row.no_response_event_id, 'no-response event id'),
    scheduleId: requiredString(row.schedule_id, 'schedule id'),
    noResponseSince: requiredString(row.no_response_since, 'no-response timestamp'),
    workDate: requiredString(row.work_date, 'work date'),
    stageType: requiredString(row.stage_type, 'stage type'),
    variant: requiredString(row.variant, 'variant'),
    jobCode: requiredString(row.job_code, 'Job code'),
    community: String(row.community ?? '').trim(),
    builderName: requiredString(row.builder_name, 'Builder'),
    phaseCode: requiredString(row.phase_code, 'Phase'),
    building: String(row.building ?? '').trim(),
    lotStartLabel: String(row.lot_start_label ?? '').trim(),
    lotEndLabel: String(row.lot_end_label ?? '').trim(),
    superintendentContactId: requiredString(
      row.superintendent_contact_id,
      'Superintendent id',
    ),
    superintendentName: requiredString(row.superintendent_name, 'Superintendent name'),
    superintendentEmail: requiredString(row.superintendent_email, 'Superintendent email'),
    escalationEnabled: Boolean(row.escalation_enabled),
    waitBusinessDays: Number(row.wait_business_days),
    recipientEmails,
    dueOn: row.due_on ? String(row.due_on) : null,
    escalationStatus: row.escalation_status ? String(row.escalation_status) : null,
    sentAt: row.sent_at ?? null,
    lastError: row.last_error ?? null,
    deliveryStatus,
    daysUntilDue: row.days_until_due === null || row.days_until_due === undefined
      ? null
      : Number(row.days_until_due),
  }
}

export function toBuilderFollowUpRescheduleRequest(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('Builder follow-up reschedule request is invalid.')
  }
  const status = requiredString(row.status, 'reschedule request status')
  if (!['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
    throw new Error('Builder follow-up reschedule request status is invalid.')
  }

  return {
    requestId: requiredString(row.request_id, 'reschedule request id'),
    scheduleId: requiredString(row.schedule_id, 'schedule id'),
    targetWorkDate: requiredString(row.target_work_date, 'current work date'),
    currentWorkDate: requiredString(row.current_work_date, 'current Production date'),
    proposedWorkDate: requiredString(row.proposed_work_date, 'requested work date'),
    requestedShiftDays: Number(row.requested_shift_days),
    reason: String(row.reason ?? '').trim(),
    status,
    submittedAt: requiredString(row.submitted_at, 'submission timestamp'),
    superintendentContactId: requiredString(
      row.superintendent_contact_id,
      'Superintendent id',
    ),
    superintendentName: requiredString(row.superintendent_name, 'Superintendent name'),
    superintendentEmail: requiredString(row.superintendent_email, 'Superintendent email'),
    stageType: requiredString(row.stage_type, 'stage type'),
    variant: requiredString(row.variant, 'variant'),
    jobCode: requiredString(row.job_code, 'Job code'),
    community: String(row.community ?? '').trim(),
    builderName: requiredString(row.builder_name, 'Builder'),
    phaseCode: requiredString(row.phase_code, 'Phase'),
    building: String(row.building ?? '').trim(),
    lotStartLabel: String(row.lot_start_label ?? '').trim(),
    lotEndLabel: String(row.lot_end_label ?? '').trim(),
  }
}

export function toBuilderFollowUpResponseHistory(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('Builder follow-up response history row is invalid.')
  }
  const responseAction = requiredString(row.response_action, 'response action')
  if (!['CONFIRMED', 'NOT_READY'].includes(responseAction)) {
    throw new Error('Builder follow-up response action is invalid.')
  }

  return {
    responseEventId: requiredString(row.response_event_id, 'response event id'),
    scheduleId: requiredString(row.schedule_id, 'schedule id'),
    responseAction,
    targetWorkDate: requiredString(row.target_work_date, 'original work date'),
    proposedWorkDate: row.proposed_work_date ? String(row.proposed_work_date) : null,
    finalWorkDate: requiredString(row.final_work_date, 'final work date'),
    currentWorkDate: requiredString(row.current_work_date, 'current Production date'),
    requestId: row.request_id ? String(row.request_id) : null,
    requestStatus: row.request_status ? String(row.request_status) : null,
    respondedAt: requiredString(row.responded_at, 'response timestamp'),
    superintendentContactId: row.superintendent_contact_id
      ? String(row.superintendent_contact_id)
      : null,
    superintendentName: requiredString(row.superintendent_name, 'Superintendent name'),
    superintendentEmail: requiredString(row.superintendent_email, 'Superintendent email'),
    reason: String(row.reason ?? '').trim(),
    stageType: requiredString(row.stage_type, 'stage type'),
    variant: requiredString(row.variant, 'variant'),
    jobCode: requiredString(row.job_code, 'Job code'),
    community: String(row.community ?? '').trim(),
    builderName: requiredString(row.builder_name, 'Builder'),
    phaseCode: requiredString(row.phase_code, 'Phase'),
    building: String(row.building ?? '').trim(),
    lotStartLabel: String(row.lot_start_label ?? '').trim(),
    lotEndLabel: String(row.lot_end_label ?? '').trim(),
  }
}

export function followUpLotsLabel(item) {
  if (!item.lotStartLabel && !item.lotEndLabel) return 'Lots not specified'
  if (!item.lotEndLabel || item.lotStartLabel === item.lotEndLabel) {
    return `Lot ${item.lotStartLabel || item.lotEndLabel}`
  }
  return `Lots ${item.lotStartLabel}–${item.lotEndLabel}`
}

export function followUpDeliveryLabel(item) {
  if (item.deliveryStatus === 'SENT') return 'Sent'
  if (item.deliveryStatus === 'OVERDUE') {
    return `${Math.abs(item.daysUntilDue)} day${Math.abs(item.daysUntilDue) === 1 ? '' : 's'} overdue`
  }
  if (item.deliveryStatus === 'DUE') return 'Due today'
  if (item.deliveryStatus === 'UPCOMING') {
    return `Due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? '' : 's'}`
  }
  return item.deliveryStatus.replaceAll('_', ' ').toLowerCase()
}

export function followUpEscalationLabel(item) {
  if (item.deliveryStatus === 'SENT') return 'Internal alert sent'
  if (item.deliveryStatus === 'FAILED') return 'Internal email failed'
  if (item.deliveryStatus === 'PROCESSING') return 'Sending internal alert'
  if (item.deliveryStatus === 'DISABLED') return 'Internal email disabled'
  if (item.deliveryStatus === 'OVERDUE') return 'Internal alert overdue'
  if (item.deliveryStatus === 'DUE') return 'Internal alert due today'
  if (item.deliveryStatus === 'CANCELLED') return 'Internal alert cancelled'
  if (item.daysUntilDue === 1) return 'Internal alert in 1 day'
  if (typeof item.daysUntilDue === 'number') {
    return `Internal alert in ${item.daysUntilDue} days`
  }
  return 'Needs attention'
}

export function toBuilderFollowUpEscalationSettings(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('Builder follow-up escalation settings are invalid.')
  }
  const recipientEmails = Array.isArray(row.recipient_emails)
    ? row.recipient_emails.map((email) => requiredString(email, 'escalation recipient'))
    : []
  if (recipientEmails.length === 0) {
    throw new Error('Builder follow-up escalation recipients are missing.')
  }
  return {
    isEnabled: Boolean(row.is_enabled),
    waitBusinessDays: Number(row.wait_business_days),
    recipientEmails,
  }
}

export function toFollowUpEmailResult(payload) {
  if (!payload || !['PREVIEW', 'LIVE'].includes(payload.mode)) {
    throw new Error('Builder follow-up email returned an invalid mode.')
  }
  return payload
}
