function routeId(value) {
  return encodeURIComponent(String(value))
}

export function builderJobsPath(builderId) {
  return `/jobs/builder/${routeId(builderId)}`
}

export function jobPlansOptionsPath(builderId, jobId) {
  return `${builderJobsPath(builderId)}/job/${routeId(jobId)}/plans-options`
}

export function jobSequenceSheetPath(builderId, jobId, phaseId) {
  const jobPath = `/sequence-sheets/builder/${routeId(builderId)}/job/${routeId(jobId)}`

  return phaseId == null
    ? jobPath
    : `${jobPath}/phase/${routeId(phaseId)}`
}

export function jobPlanPricingPath(builderId, jobId) {
  return `/pricing/builder/${routeId(builderId)}/job/${routeId(jobId)}`
}

export function getJobBuilderId(job, builders = []) {
  if (job?.builderId != null) return job.builderId

  return builders.find((builder) => builder.name === job?.builder)?.id ?? null
}

export function jobBelongsToBuilder(job, builderId, builders = []) {
  const jobBuilderId = getJobBuilderId(job, builders)

  return jobBuilderId != null && String(jobBuilderId) === String(builderId)
}
