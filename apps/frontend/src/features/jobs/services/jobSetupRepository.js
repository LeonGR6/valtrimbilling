import { requireSupabase } from '../../../services/api.js'

function toSetupChangeError(error) {
  if (error.code === '42501') {
    return new Error('You do not have permission to change the billing setup of a Job.', { cause: error })
  }
  if (error.code === 'P0002') {
    return new Error('The Job or the billing setup version is no longer available.', { cause: error })
  }
  if (error.code === '23514') {
    return new Error(error.message || 'Review the reason for the change.', { cause: error })
  }
  // A refused change (55000) already says why, in words for the reader.
  return new Error(error.message || 'The billing setup change failed.', { cause: error })
}

/** What would stop a Job from taking a version, and what to check first: `{ allowed, blockers, warnings }`. */
export async function previewJobSetupChange(jobId, versionId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('preview_job_billing_setup_change', {
    p_job_id: Number(jobId),
    p_version_id: Number(versionId),
  })
  if (error) throw toSetupChangeError(error)

  return {
    allowed: Boolean(data?.allowed),
    blockers: Array.isArray(data?.blockers) ? data.blockers : [],
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  }
}

/** Moves a Job to another version of its Builder's setup. Refused while the Job has Packages. */
export async function changeJobSetup({ jobId, versionId, reason }) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('change_job_billing_setup', {
    p_job_id: Number(jobId),
    p_version_id: Number(versionId),
    p_reason: String(reason ?? '').trim() || null,
  })
  if (error) throw toSetupChangeError(error)

  return {
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
    toVersionId: data?.toVersionId ?? Number(versionId),
  }
}

/**
 * What a Job's page says about its setup being fixed or not: how many Packages that are not
 * voided it has (the setup is locked while there is one), and the last time it was changed.
 */
export async function loadJobSetupState(jobId) {
  const client = await requireSupabase()
  const [packages, changes] = await Promise.all([
    client
      .from('draw_packages')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', Number(jobId))
      .neq('status', 'VOIDED'),
    client
      .from('job_billing_setup_changes')
      .select('from_version_id, to_version_id, reason, changed_at')
      .eq('job_id', Number(jobId))
      .order('changed_at', { ascending: false })
      .limit(1),
  ])
  if (packages.error) throw new Error(packages.error.message, { cause: packages.error })
  if (changes.error) throw new Error(changes.error.message, { cause: changes.error })

  const last = changes.data?.[0] ?? null
  return {
    packageCount: packages.count ?? 0,
    lastChange: last
      ? {
        fromVersionId: last.from_version_id,
        toVersionId: last.to_version_id,
        reason: last.reason ?? '',
        changedAt: last.changed_at,
      }
      : null,
  }
}
