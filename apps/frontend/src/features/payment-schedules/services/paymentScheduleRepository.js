import { requireSupabase } from '../../../services/api.js'
import { toPaymentScheduleTemplate } from './paymentScheduleRecord.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'

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
    throw new Error(await functionErrorMessage(error, data, 'The Payment Schedule analysis failed.'), { cause: error })
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

/** The Lots of a Job with the code of their Phase: what tells a schedule's Lots apart. */
export async function listJobLots(jobId) {
  const client = await requireSupabase()
  const [lots, phases] = await Promise.all([
    client
      .from('lots')
      .select('lot_number, phase_id, is_utility_building')
      .eq('job_id', Number(jobId)),
    client
      .from('phases')
      .select('id, code')
      .eq('job_id', Number(jobId))
      .eq('is_active', true),
  ])

  const failure = lots.error ?? phases.error
  if (failure) throw new Error(failure.message || 'The Job Lots could not be loaded.', { cause: failure })

  const codeById = new Map((phases.data ?? []).map((row) => [row.id, row.code]))
  return (lots.data ?? [])
    // A utility building has no Lot number of its own.
    .filter((row) => !row.is_utility_building && row.lot_number && codeById.has(row.phase_id))
    .map((row) => ({ lot: row.lot_number, phase: codeById.get(row.phase_id) }))
}
