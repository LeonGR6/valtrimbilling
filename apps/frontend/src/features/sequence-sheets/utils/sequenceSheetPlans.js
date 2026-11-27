export function getPlan(job, planId) {
  return (job.sequenceSheet?.plans ?? []).find(
    (plan) => plan.id === Number(planId),
  )
}
