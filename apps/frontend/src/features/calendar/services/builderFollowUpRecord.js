const DELIVERY_STATUSES = new Set([
  'UPCOMING',
  'DUE',
  'OVERDUE',
  'PROCESSING',
  'FAILED',
  'COMPLETED',
  'SKIPPED',
  'CANCELLED',
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
  if (item.deliveryStatus === 'OVERDUE') {
    return `${Math.abs(item.daysUntilDue)} day${Math.abs(item.daysUntilDue) === 1 ? '' : 's'} overdue`
  }
  if (item.deliveryStatus === 'DUE') return 'Due today'
  if (item.deliveryStatus === 'UPCOMING') {
    return `Due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? '' : 's'}`
  }
  return item.deliveryStatus.replaceAll('_', ' ').toLowerCase()
}

export function toFollowUpEmailResult(payload) {
  if (!payload || !['PREVIEW', 'LIVE'].includes(payload.mode)) {
    throw new Error('Builder follow-up email returned an invalid mode.')
  }
  return payload
}
