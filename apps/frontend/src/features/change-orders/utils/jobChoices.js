/**
 * The Jobs an Extra / CO can be for once its Builder is chosen: every Job of that Builder, in the order
 * the Jobs come. Without a Builder there is nothing to choose from.
 */
export function jobsOfBuilder(jobs, builderId) {
  if (!builderId) return []
  return jobs.filter((job) => String(job.builderId) === String(builderId))
}

/** How a Job reads in the list: its number and its Community, e.g. "#1247 · Rancho Madrina". */
export function jobChoiceLabel(job) {
  return job.community ? `#${job.code} · ${job.community}` : `#${job.code}`
}
