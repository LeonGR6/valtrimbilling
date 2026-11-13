import {
  filterJobsByScope,
  jobBuilderOptions,
  jobCommunityOptions,
} from '../../jobs/utils/jobScopeFilters.js'

// The Job document center filters Jobs the same way as every Jobs list.
export const jobDocumentBuilderOptions = jobBuilderOptions
export const jobDocumentCommunityOptions = jobCommunityOptions
export const filterJobsForDocuments = filterJobsByScope

/** Jobs for which `isMissing` is true first; the order inside each group is kept. */
export function sortJobsMissingFirst(jobs = [], isMissing = () => false) {
  return [
    ...jobs.filter((job) => isMissing(job)),
    ...jobs.filter((job) => !isMissing(job)),
  ]
}
