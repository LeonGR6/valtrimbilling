import { requireSupabase } from '../../../services/api.js'
import {
  toBuilderFollowUpItem,
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
  const { data, error } = await client.rpc('refresh_builder_follow_up_checkpoints')
  repositoryError(error)
  return Number(data ?? 0)
}

export async function listBuilderFollowUps() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_follow_up_queue')
    .select(QUEUE_COLUMNS)
    .eq('checkpoint_status', 'PENDING')
    .order('due_on', { ascending: true })
    .order('checkpoint_id', { ascending: true })
  repositoryError(error)
  return (data ?? []).map(toBuilderFollowUpItem)
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
