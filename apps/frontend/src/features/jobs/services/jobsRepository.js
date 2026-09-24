import { requireSupabase } from '../../../services/api.js'
import { toJob, toJobMutation } from './jobRecord.js'

const JOB_COLUMNS = [
  'id',
  'code',
  'builder_id',
  'community',
  'supervisor_id',
  'superintendent_id',
  'billing_setup_version_id',
  'sequence_sheet_name',
  'status',
  'notes',
  'is_active',
  'created_at',
  'updated_at',
].join(', ')

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '23505') {
    throw new Error('A Job with that number already exists.', { cause: error })
  }

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Jobs.', { cause: error })
  }

  if (error.code === '23503') {
    throw new Error('The selected Builder or team assignment is no longer available.', {
      cause: error,
    })
  }

  if (error.message?.includes('version ACTIVE de Billing Setup')) {
    throw new Error('The selected Builder needs an active Billing Setup before creating a Job.', {
      cause: error,
    })
  }

  if (error.message?.includes('supervisor debe estar activo')) {
    throw new Error('Select an active Supervisor.', { cause: error })
  }

  if (error.message?.includes('Superintendent debe estar activo')) {
    throw new Error('Select an active Jobsite Superintendent for this Builder.', {
      cause: error,
    })
  }

  if (error.message?.includes('builder debe estar activo')) {
    throw new Error('Select an active Builder.', { cause: error })
  }

  throw new Error(error.message || 'The Jobs request failed.', { cause: error })
}

export async function listJobs() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('jobs')
    .select(JOB_COLUMNS)
    .order('code', { ascending: true })

  throwRepositoryError(error)
  return (data ?? []).map(toJob)
}

export async function createJob(job) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('jobs')
    .insert(toJobMutation(job))
    .select(JOB_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toJob(data)
}

export async function updateJob(jobId, job) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('jobs')
    .update(toJobMutation(job))
    .eq('id', jobId)
    .select(JOB_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toJob(data)
}

export async function deactivateJob(jobId) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('jobs')
    .update({ is_active: false })
    .eq('id', jobId)
    .select(JOB_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toJob(data)
}
