import { getJobBuilderId } from './jobRoutes.js'

// Builder / Community / text filters shared by the screens that list Jobs.

const byName = (left, right) => left.localeCompare(right, 'en', {
  numeric: true,
  sensitivity: 'base',
})

export function jobBuilderOptions(jobs = []) {
  return [...new Map(jobs
    .filter((job) => job.builder)
    .map((job) => [
      String(getJobBuilderId(job)),
      { id: String(getJobBuilderId(job)), name: job.builder },
    ])).values()]
    .sort((left, right) => byName(left.name, right.name))
}

/** Communities of the chosen Builder, or of every Builder when none is chosen. */
export function jobCommunityOptions(jobs = [], builderId = 'ALL') {
  return [...new Set(jobs
    .filter((job) => builderId === 'ALL'
      || String(getJobBuilderId(job)) === String(builderId))
    .map((job) => job.community)
    .filter(Boolean))].sort(byName)
}

export function filterJobsByScope(jobs = [], {
  search = '',
  builderId = 'ALL',
  community = 'ALL',
} = {}) {
  const normalizedSearch = String(search).trim().toLowerCase()

  return jobs.filter((job) => {
    if (builderId !== 'ALL' && String(getJobBuilderId(job)) !== String(builderId)) {
      return false
    }
    if (community !== 'ALL' && job.community !== community) return false
    if (!normalizedSearch) return true

    return [job.code, job.builder, job.community]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch))
  })
}

/** A remembered Builder or Community that no longer exists falls back to "ALL". */
export function resolveJobScope(jobs, stored) {
  const builderOptions = jobBuilderOptions(jobs)
  const builderId = stored.builderId === 'ALL'
    || builderOptions.some(({ id }) => id === stored.builderId)
    ? stored.builderId
    : 'ALL'
  const communityOptions = jobCommunityOptions(jobs, builderId)
  const community = stored.community === 'ALL'
    || communityOptions.includes(stored.community)
    ? stored.community
    : 'ALL'

  return { builderId, community, builderOptions, communityOptions }
}
