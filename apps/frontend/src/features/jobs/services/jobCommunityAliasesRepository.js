import { requireSupabase } from '../../../services/api.js'

// Other names of a Job's community (26 Nov 2026). Customer Service saves one when the
// coordinator links an email that named the community differently; the email import then
// links the next email with that name by itself. A name belongs to one Job per Builder.

function throwAliasError(error) {
  if (!error) return
  if (error.code === '23505') {
    throw new Error('Another Job of this Builder already uses that name.', { cause: error })
  }
  if (error.code === '42501') {
    throw new Error('You do not have permission to change the names of a Job.', { cause: error })
  }
  if (error.code === '23503') {
    throw new Error('The Job is no longer available.', { cause: error })
  }
  if (error.code === '23514') {
    throw new Error('That name is too short to be remembered.', { cause: error })
  }
  throw new Error(error.message || 'The Job name could not be saved.', { cause: error })
}

export async function createJobCommunityAlias({ jobId, builderId, alias, aliasKey }) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('job_community_aliases')
    .insert({ job_id: Number(jobId), builder_id: Number(builderId), alias, alias_key: aliasKey })
    .select('id, alias')
    .single()

  throwAliasError(error)
  return { id: data.id, alias: data.alias }
}

export async function deleteJobCommunityAlias(aliasId) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('job_community_aliases')
    .delete()
    .eq('id', aliasId)
    .select('id')

  throwAliasError(error)
  // Row security hides the row from a role that cannot remove it.
  if (!data?.length) throw new Error('The name was already removed, or your role cannot remove it. Reload Jobs.')
}
