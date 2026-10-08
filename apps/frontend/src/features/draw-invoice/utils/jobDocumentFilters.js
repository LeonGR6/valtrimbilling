import { getJobBuilderId } from '../../jobs/utils/jobRoutes.js'

const byName = (left, right) => left.localeCompare(right, 'en', {
  numeric: true,
  sensitivity: 'base',
})

export function jobDocumentBuilderOptions(jobs = []) {
  return [...new Map(jobs
    .filter((job) => job.builder)
    .map((job) => [
      String(getJobBuilderId(job)),
      { id: String(getJobBuilderId(job)), name: job.builder },
    ])).values()]
    .sort((left, right) => byName(left.name, right.name))
}

/** Communities of the chosen Builder, or of every Builder when none is chosen. */
export function jobDocumentCommunityOptions(jobs = [], builderId = 'ALL') {
  return [...new Set(jobs
    .filter((job) => builderId === 'ALL'
      || String(getJobBuilderId(job)) === String(builderId))
    .map((job) => job.community)
    .filter(Boolean))].sort(byName)
}

export function filterJobsForDocuments(jobs = [], {
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
