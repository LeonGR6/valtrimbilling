import { requireSupabase } from '../../../services/api.js'
import { toPaymentScheduleTemplate } from './paymentScheduleRecord.js'

const ANALYZE_FUNCTION = 'payment-schedule-analyze'

const TEMPLATE_COLUMNS = [
  'id',
  'job_document_id',
  'job_id',
  'layout',
  'detection_method',
  'page_count',
  'page_sizes',
  'detected_cells',
  'analysis',
  'mapping',
  'status',
  'error',
  'confirmed_by',
  'confirmed_at',
  'analyzed_at',
  'created_at',
  'updated_at',
].join(', ')

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }
  return error?.message || 'The Payment Schedule analysis failed.'
}

function toConfirmError(error) {
  if (error.code === '42501') {
    return new Error('You do not have permission to confirm Payment Schedules.', {
      cause: error,
    })
  }
  if (error.code === 'P0002') {
    return new Error('This Payment Schedule is no longer available.', { cause: error })
  }
  if (error.code === '55000') {
    return new Error(
      'This Payment Schedule cannot be confirmed in its current state. Reopen it.',
      { cause: error },
    )
  }
  // Validation messages from the database are written for the reviewer.
  return new Error(error.message || 'The Payment Schedule could not be confirmed.', {
    cause: error,
  })
}

export async function listPaymentScheduleTemplates(documentIds) {
  if (documentIds.length === 0) return {}

  const client = await requireSupabase()
  const { data, error } = await client
    .from('payment_schedule_templates')
    .select(TEMPLATE_COLUMNS)
    .in('job_document_id', documentIds)

  if (error) {
    throw new Error(error.message || 'Payment Schedules could not be loaded.', {
      cause: error,
    })
  }

  return Object.fromEntries(
    (data ?? []).map((row) => {
      const template = toPaymentScheduleTemplate(row)
      return [template.documentId, template]
    }),
  )
}

export async function analyzePaymentSchedule(documentId, { force = false } = {}) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(ANALYZE_FUNCTION, {
    body: { job_document_id: documentId, force },
  })

  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }
  return toPaymentScheduleTemplate(data.template)
}

export async function confirmPaymentSchedule({ templateId, mapping }) {
  const client = await requireSupabase()
  const { error } = await client.rpc('confirm_payment_schedule_template', {
    p_template_id: templateId,
    p_mapping: mapping,
  })

  if (error) throw toConfirmError(error)
}

/** The Phases of a Job, for choosing which one a printed Phase stands for. */
export async function listJobPhases(jobId) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('phases')
    .select('id, code, building, is_active')
    .eq('job_id', Number(jobId))
    .order('code', { ascending: true })

  if (error) throw new Error(error.message || 'The Job Phases could not be loaded.', { cause: error })
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    building: row.building,
    isActive: row.is_active,
  }))
}
