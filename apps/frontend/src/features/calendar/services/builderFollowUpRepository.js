import { requireSupabase } from '../../../services/api.js'
import {
  toBuilderFollowUpAttentionItem,
  toBuilderFollowUpEscalationSettings,
  toBuilderFollowUpItem,
  toBuilderFollowUpResponseHistory,
  toBuilderFollowUpRescheduleRequest,
  toFollowUpEmailResult,
} from './builderFollowUpRecord.js'

const EMAIL_FUNCTION = 'builder-follow-up-email'
const QUEUE_COLUMNS = [
  'checkpoint_id',
  'schedule_id',
  'checkpoint_code',
  'days_before',
  'stage_type',
  'variant',
  'work_date',
  'due_on',
  'checkpoint_status',
  'follow_up_status',
  'job_code',
  'community',
  'builder_name',
  'phase_code',
  'building',
  'lot_start_label',
  'lot_end_label',
  'recipient_contact_id',
  'recipient_name',
  'recipient_email',
  'recipient_is_active',
  'email_status',
  'sent_at',
  'last_error',
  'delivery_status',
  'days_until_due',
  'confirmed_at',
  'last_response_at',
].join(', ')

const ATTENTION_COLUMNS = [
  'escalation_id',
  'no_response_event_id',
  'schedule_id',
  'no_response_since',
  'work_date',
  'stage_type',
  'variant',
  'job_code',
  'community',
  'builder_name',
  'phase_code',
  'building',
  'lot_start_label',
  'lot_end_label',
  'superintendent_contact_id',
  'superintendent_name',
  'superintendent_email',
  'escalation_enabled',
  'wait_business_days',
  'recipient_emails',
  'due_on',
  'escalation_status',
  'sent_at',
  'last_error',
  'delivery_status',
  'days_until_due',
].join(', ')

const RESCHEDULE_COLUMNS = [
  'request_id',
  'schedule_id',
  'target_work_date',
  'current_work_date',
  'proposed_work_date',
  'requested_shift_days',
  'reason',
  'status',
  'submitted_at',
  'superintendent_contact_id',
  'superintendent_name',
  'superintendent_email',
  'stage_type',
  'variant',
  'job_code',
  'community',
  'builder_name',
  'phase_code',
  'building',
  'lot_start_label',
  'lot_end_label',
].join(', ')

const RESPONSE_HISTORY_COLUMNS = [
  'response_event_id',
  'schedule_id',
  'response_action',
  'target_work_date',
  'proposed_work_date',
  'final_work_date',
  'current_work_date',
  'request_id',
  'request_status',
  'responded_at',
  'superintendent_contact_id',
  'superintendent_name',
  'superintendent_email',
  'reason',
  'stage_type',
  'variant',
  'job_code',
  'community',
  'builder_name',
  'phase_code',
  'building',
  'lot_start_label',
  'lot_end_label',
].join(', ')

function repositoryError(error) {
  if (!error) return
  if (error.code === '42501') {
    throw new Error('You do not have permission to manage Builder follow-ups.', {
      cause: error,
    })
  }
  if (error.code === 'P0002') {
    throw new Error('This follow-up is no longer eligible. Refresh the queue.', {
      cause: error,
    })
  }
  throw new Error(error.message || 'The Builder follow-up request failed.', {
    cause: error,
  })
}

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }
  return error?.message || 'The Builder follow-up email request failed.'
}

async function invokeEmail(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(EMAIL_FUNCTION, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }
  return toFollowUpEmailResult(data)
}

export async function refreshBuilderFollowUps() {
  const client = await requireSupabase()
  const [checkpointResult, escalationResult] = await Promise.all([
    client.rpc('refresh_builder_follow_up_checkpoints'),
    client.rpc('refresh_builder_follow_up_escalations'),
  ])
  repositoryError(checkpointResult.error)
  repositoryError(escalationResult.error)
  return Number(checkpointResult.data ?? 0) + Number(escalationResult.data ?? 0)
}

export async function listBuilderFollowUps() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_follow_up_queue')
    .select(QUEUE_COLUMNS)
    .order('work_date', { ascending: true })
    .order('due_on', { ascending: true })
    .order('checkpoint_id', { ascending: true })
  repositoryError(error)
  return (data ?? []).map(toBuilderFollowUpItem)
}

export async function listBuilderFollowUpAttention() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_follow_up_attention_queue')
    .select(ATTENTION_COLUMNS)
    .order('no_response_since', { ascending: true })
    .order('schedule_id', { ascending: true })
  repositoryError(error)
  return (data ?? []).map(toBuilderFollowUpAttentionItem)
}

export async function listBuilderFollowUpRescheduleRequests() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_follow_up_reschedule_queue')
    .select(RESCHEDULE_COLUMNS)
    .eq('status', 'PENDING')
    .order('submitted_at', { ascending: true })
    .order('request_id', { ascending: true })
  repositoryError(error)
  return (data ?? []).map(toBuilderFollowUpRescheduleRequest)
}

export async function listBuilderFollowUpResponses(limit = 25) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_follow_up_response_history')
    .select(RESPONSE_HISTORY_COLUMNS)
    .order('responded_at', { ascending: false })
    .order('response_event_id', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 25, 1), 100))
  repositoryError(error)
  return (data ?? []).map(toBuilderFollowUpResponseHistory)
}

export async function resolveBuilderFollowUpRescheduleRequest(
  requestId,
  decision,
  reviewNote = null,
) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc(
    'resolve_builder_follow_up_reschedule_request',
    {
      p_request_id: requestId,
      p_decision: decision,
      p_review_note: reviewNote,
    },
  )
  repositoryError(error)
  return data
}

export async function getBuilderFollowUpEscalationSettings() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_follow_up_escalation_settings')
    .select('is_enabled, wait_business_days, recipient_emails')
    .eq('id', 1)
    .single()
  repositoryError(error)
  return toBuilderFollowUpEscalationSettings(data)
}

export async function saveBuilderFollowUpEscalationSettings(settings) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc(
    'save_builder_follow_up_escalation_settings',
    {
      p_is_enabled: settings.isEnabled,
      p_wait_business_days: settings.waitBusinessDays,
      p_recipient_emails: settings.recipientEmails,
    },
  )
  repositoryError(error)
  return {
    isEnabled: Boolean(data?.isEnabled),
    waitBusinessDays: Number(data?.waitBusinessDays),
    recipientEmails: Array.isArray(data?.recipientEmails) ? data.recipientEmails : [],
  }
}

export async function getBuilderFollowUpEmailMode() {
  return invokeEmail({ action: 'status' })
}

export async function previewBuilderFollowUpEmail(checkpointId) {
  return invokeEmail({ action: 'preview_checkpoint', checkpointId })
}

export async function sendBuilderFollowUpEmail(checkpointId) {
  return invokeEmail({ action: 'send_checkpoint', checkpointId })
}

export async function previewBuilderFollowUpEscalation(escalationId) {
  return invokeEmail({ action: 'preview_escalation', escalationId })
}

export async function sendBuilderFollowUpEscalation(escalationId) {
  return invokeEmail({ action: 'send_escalation', escalationId })
}

export async function sendDueBuilderFollowUpEmails(limit = 25) {
  return invokeEmail({ action: 'send_due', limit })
}

export async function recordBuilderFollowUpStatus(scheduleId, status, note = null) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('record_builder_follow_up_status', {
    p_schedule_id: scheduleId,
    p_status: status,
    p_note: note,
  })
  repositoryError(error)
  return String(data)
}
