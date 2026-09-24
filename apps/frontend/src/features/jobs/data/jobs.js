export const emptyJob = {
  code: '',
  builder: '',
  community: '',
  supervisorId: null,
  superintendentId: null,
}

export const emptyJobPlan = {
  code: '',
  name: '',
}

export const emptyPlanOption = {
  code: '',
  description: '',
}

export function getJobUnitCount(job) {
  return getJobAssignedLotCount(job)
}

export function getJobPlanCount(job) {
  return job.sequenceSheet?.plans?.length ?? 0
}

export function getJobOptionCount(job) {
  return (job.sequenceSheet?.plans ?? []).reduce(
    (total, plan) => total + (plan.options?.length ?? 0),
    0,
  )
}

export function getJobSequenceColumnCount(job) {
  return getJobPlanCount(job) + getJobOptionCount(job)
}

export function getJobPhaseCount(job) {
  return job.sequenceSheet?.phases?.length ?? 0
}

export function getJobAssignedLotCount(job) {
  return (job.sequenceSheet?.phases ?? []).reduce(
    (total, phase) => total + (phase.lots?.length ?? 0),
    0,
  )
}

function getJobLotDependencies(job, predicate) {
  return (job.sequenceSheet?.phases ?? []).flatMap((phase) =>
    (phase.lots ?? [])
      .filter(predicate)
      .map((lot) => ({
        phaseId: phase.id,
        phaseName: phase.name,
        building: phase.building,
        lotId: lot.id,
        lotNumber: lot.lotNumber,
      })),
  )
}

export function getPlanLotDependencies(job, planId) {
  const plan = (job.sequenceSheet?.plans ?? []).find(
    (item) => item.id === planId,
  )
  const planOptionIds = new Set((plan?.options ?? []).map((option) => option.id))

  return getJobLotDependencies(
    job,
    (lot) =>
      lot.planId === planId ||
      (lot.optionIds ?? []).some((optionId) => planOptionIds.has(optionId)),
  )
}

export function getOptionLotDependencies(job, optionId) {
  return getJobLotDependencies(
    job,
    (lot) => (lot.optionIds ?? []).includes(optionId),
  )
}

export function formatJobHierarchy(job) {
  return [job.builder, job.community].filter(Boolean).join(' / ')
}
