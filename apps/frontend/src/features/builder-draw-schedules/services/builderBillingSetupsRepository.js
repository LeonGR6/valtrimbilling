import { requireSupabase } from '../../../services/api.js'
import {
  toBuilderBillingSetupRpc,
  toBuilderDrawSchedule,
} from './builderBillingSetupRecord.js'

const VERSION_COLUMNS = [
  'id',
  'builder_id',
  'version_number',
  'status',
  'separate_hardware_price',
  'hardware_billing_draw_number',
  'options_billing_draw_number',
  'frequency',
  'cutoff_day',
  'submission_day',
  'cutoff_days',
  'cutoff_weekday',
  'submission_offset_days',
  'work_accepted_through',
  'invoice_date_rule',
  'payment_terms_days',
  'retention_enabled',
  'retention_percentage',
  'wrap_enabled',
  'wrap_percentage',
  'invoice_line_format',
  'portal_name',
  'notes',
].join(', ')

const DRAW_COLUMNS = [
  'id',
  'setup_version_id',
  'draw_number',
  'name',
  'percentage',
].join(', ')

const DOCUMENT_COLUMNS = [
  'id',
  'setup_version_id',
  'document_type',
  'is_required',
  'display_order',
].join(', ')

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Builder billing setups.', {
      cause: error,
    })
  }

  if (error.code === '23503') {
    throw new Error('Select an active Builder that still exists.', { cause: error })
  }

  if (error.code === '23505') {
    throw new Error('This Builder already has an active billing setup.', {
      cause: error,
    })
  }

  if (error.code === '23514') {
    throw new Error('Review the billing frequency, draws and deduction values.', {
      cause: error,
    })
  }

  throw new Error(error.message || 'The Builder billing setup request failed.', {
    cause: error,
  })
}

export async function listBuilderBillingSetups() {
  const client = await requireSupabase()
  const { data: versions, error: versionsError } = await client
    .from('billing_setup_versions')
    .select(VERSION_COLUMNS)
    .eq('status', 'ACTIVE')
    .order('builder_id', { ascending: true })

  throwRepositoryError(versionsError)

  if (!versions?.length) return []

  const versionIds = versions.map(({ id }) => id)
  const [drawResult, documentResult] = await Promise.all([
    client
      .from('billing_draws')
      .select(DRAW_COLUMNS)
      .in('setup_version_id', versionIds)
      .order('setup_version_id', { ascending: true })
      .order('draw_number', { ascending: true }),
    client
      .from('billing_required_documents')
      .select(DOCUMENT_COLUMNS)
      .in('setup_version_id', versionIds)
      .order('setup_version_id', { ascending: true })
      .order('display_order', { ascending: true }),
  ])

  throwRepositoryError(drawResult.error)
  throwRepositoryError(documentResult.error)

  return versions.map((version) => toBuilderDrawSchedule(
    version,
    drawResult.data ?? [],
    documentResult.data ?? [],
  ))
}

export async function saveBuilderBillingSetup(schedule) {
  const client = await requireSupabase()
  const { error } = await client.rpc(
    'save_builder_billing_setup',
    toBuilderBillingSetupRpc(schedule),
  )

  throwRepositoryError(error)

  const schedules = await listBuilderBillingSetups()
  const saved = schedules.find(
    (candidate) => candidate.builderId === Number(schedule.builderId),
  )

  if (!saved) {
    throw new Error('The saved Builder billing setup could not be reloaded.')
  }

  return saved
}

export async function deactivateBuilderBillingSetup(builderId) {
  const client = await requireSupabase()
  const { error } = await client.rpc('deactivate_builder_billing_setup', {
    p_builder_id: Number(builderId),
  })

  throwRepositoryError(error)
}
