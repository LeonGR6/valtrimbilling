import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { useBuilders } from '../../builders/context/useBuilders.js'
import {
  createJob as createJobRecord,
  deactivateJob as deactivateJobRecord,
  listJobs,
  updateJob as updateJobRecord,
} from '../services/jobsRepository.js'
import {
  createJobPlan as createJobPlanRecord,
  createPlanOption as createPlanOptionRecord,
  deactivateJobPlan as deactivateJobPlanRecord,
  deactivatePlanOption as deactivatePlanOptionRecord,
  listJobPlans,
  saveJobPlanPrice as saveJobPlanPriceRecord,
  savePlanOptionPrice as savePlanOptionPriceRecord,
  updateJobPlan as updateJobPlanRecord,
  updatePlanOption as updatePlanOptionRecord,
} from '../services/jobPlansRepository.js'
import {
  mergeJobPlanRecord,
  mergePlanOptionRecord,
} from '../services/jobPlanRecord.js'
import {
  deactivateSequenceSheetPhase as deactivateSequenceSheetPhaseRecord,
  listSequenceSheetPhases,
  saveSequenceSheetPhase as saveSequenceSheetPhaseRecord,
} from '../../sequence-sheets/services/sequenceSheetsRepository.js'
import { JobsContext } from './jobsContext.js'

function sortJobs(jobs) {
  return [...jobs].sort((left, right) => left.code.localeCompare(right.code))
}

function updateJobPlans(job, updatePlans) {
  return {
    ...job,
    sequenceSheet: {
      ...job.sequenceSheet,
      plans: updatePlans(job.sequenceSheet?.plans ?? []),
    },
  }
}

function updateJobPhases(job, updatePhases) {
  return {
    ...job,
    sequenceSheet: {
      ...job.sequenceSheet,
      phases: updatePhases(job.sequenceSheet?.phases ?? []),
    },
  }
}

export function JobsProvider({ children }) {
  const { profile } = useAuth()
  const { builders } = useBuilders()
  const [jobRecords, setJobRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canManageJobs = ['ADMIN', 'PROJECT_MANAGEMENT'].includes(profile?.role)
  const buildersById = useMemo(
    () => new Map(builders.map((builder) => [String(builder.id), builder])),
    [builders],
  )
  const jobs = useMemo(
    () => jobRecords.map((job) => ({
      ...job,
      builder: buildersById.get(String(job.builderId))?.name ?? job.builder ?? '',
    })),
    [buildersById, jobRecords],
  )

  const refreshJobs = useCallback(async () => {
    if (!profile?.id) {
      setJobRecords([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const records = await listJobs()
      const jobIds = records.map(({ id }) => id)
      const [plansByJob, phasesByJob] = await Promise.all([
        listJobPlans(jobIds),
        listSequenceSheetPhases(jobIds),
      ])
      const recordsWithPlans = records.map((job) => ({
        ...job,
        sequenceSheet: {
          ...job.sequenceSheet,
          plans: plansByJob.get(job.id) ?? [],
          phases: phasesByJob.get(job.id) ?? [],
        },
      }))
      setJobRecords(recordsWithPlans)
      setError(null)
      return recordsWithPlans
    } catch (loadError) {
      setError(loadError.message)
      throw loadError
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) {
      // Authentication is the source of truth for clearing tenant data.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJobRecords([])
      setError(null)
      setLoading(false)
      return undefined
    }

    refreshJobs().catch(() => {})
    return undefined
  }, [profile?.id, refreshJobs])

  const createJob = useCallback(async (job) => {
    const created = await createJobRecord(job)
    setJobRecords((current) => sortJobs([created, ...current]))
    setError(null)
    return created
  }, [])

  const updateJob = useCallback(async (jobId, job) => {
    const updated = await updateJobRecord(jobId, job)
    setJobRecords((current) => sortJobs(current.map((item) => (
      item.id === jobId
        ? { ...item, ...updated, sequenceSheet: item.sequenceSheet }
        : item
    ))))
    setError(null)
    return updated
  }, [])

  const deactivateJob = useCallback(async (jobId) => {
    const updated = await deactivateJobRecord(jobId)
    setJobRecords((current) => current.map((item) => (
      item.id === jobId
        ? { ...item, ...updated, sequenceSheet: item.sequenceSheet }
        : item
    )))
    setError(null)
    return updated
  }, [])

  const createJobPlan = useCallback(async (jobId, plan) => {
    const created = await createJobPlanRecord(jobId, plan)
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPlans(job, (plans) => [...plans, created])
        : job
    )))
    setError(null)
    return created
  }, [])

  const updateJobPlan = useCallback(async (jobId, planId, plan) => {
    const updated = await updateJobPlanRecord(planId, { ...plan, jobId })
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPlans(job, (plans) => plans.map((currentPlan) => (
            currentPlan.id === planId
              ? mergeJobPlanRecord(currentPlan, updated)
              : currentPlan
          )))
        : job
    )))
    setError(null)
    return updated
  }, [])

  const deactivateJobPlan = useCallback(async (jobId, planId) => {
    await deactivateJobPlanRecord(planId)
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPlans(
            job,
            (plans) => plans.filter((plan) => plan.id !== planId),
          )
        : job
    )))
    setError(null)
  }, [])

  const createPlanOption = useCallback(async (jobId, planId, option) => {
    const created = await createPlanOptionRecord(planId, option)
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPlans(job, (plans) => plans.map((plan) => (
            plan.id === planId
              ? { ...plan, options: [...(plan.options ?? []), created] }
              : plan
          )))
        : job
    )))
    setError(null)
    return created
  }, [])

  const updatePlanOption = useCallback(async (
    jobId,
    planId,
    optionId,
    option,
  ) => {
    const updated = await updatePlanOptionRecord(optionId, { ...option, planId })
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPlans(job, (plans) => plans.map((plan) => (
            plan.id === planId
              ? {
                  ...plan,
                  options: (plan.options ?? []).map((currentOption) => (
                    currentOption.id === optionId
                      ? mergePlanOptionRecord(currentOption, updated)
                      : currentOption
                  )),
                }
              : plan
          )))
        : job
    )))
    setError(null)
    return updated
  }, [])

  const deactivatePlanOption = useCallback(async (
    jobId,
    planId,
    optionId,
  ) => {
    await deactivatePlanOptionRecord(optionId)
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPlans(job, (plans) => plans.map((plan) => (
            plan.id === planId
              ? {
                  ...plan,
                  options: (plan.options ?? []).filter(
                    (option) => option.id !== optionId,
                  ),
                }
              : plan
          )))
        : job
    )))
    setError(null)
  }, [])

  const saveJobPlanPrice = useCallback(async (
    jobId,
    planId,
    basePrice,
    hardwarePrice,
  ) => {
    const saved = await saveJobPlanPriceRecord(
      planId,
      basePrice,
      hardwarePrice,
    )
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPlans(job, (plans) => plans.map((plan) => (
            plan.id === planId ? { ...plan, ...saved } : plan
          )))
        : job
    )))
    setError(null)
    return saved
  }, [])

  const savePlanOptionPrice = useCallback(async (
    jobId,
    planId,
    optionId,
    price,
  ) => {
    const saved = await savePlanOptionPriceRecord(optionId, price)
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPlans(job, (plans) => plans.map((plan) => (
            plan.id === planId
              ? {
                  ...plan,
                  options: (plan.options ?? []).map((option) => (
                    option.id === optionId ? { ...option, ...saved } : option
                  )),
                }
              : plan
          )))
        : job
    )))
    setError(null)
    return saved
  }, [])

  const saveSequenceSheetPhase = useCallback(async (
    jobId,
    phaseId,
    phase,
  ) => {
    const saved = await saveSequenceSheetPhaseRecord(jobId, phaseId, phase)
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPhases(job, (phases) => {
            const phaseExists = phases.some((candidate) => candidate.id === saved.id)
            return phaseExists
              ? phases.map((candidate) => (
                  candidate.id === saved.id ? saved : candidate
                ))
              : [...phases, saved]
          })
        : job
    )))
    setError(null)
    return saved
  }, [])

  const deactivateSequenceSheetPhase = useCallback(async (jobId, phaseId) => {
    await deactivateSequenceSheetPhaseRecord(phaseId)
    setJobRecords((current) => current.map((job) => (
      job.id === jobId
        ? updateJobPhases(
            job,
            (phases) => phases.filter((phase) => phase.id !== phaseId),
          )
        : job
    )))
    setError(null)
  }, [])

  const value = useMemo(() => ({
    jobs,
    loading,
    error,
    canManageJobs,
    refreshJobs,
    createJob,
    updateJob,
    deactivateJob,
    createJobPlan,
    updateJobPlan,
    deactivateJobPlan,
    createPlanOption,
    updatePlanOption,
    deactivatePlanOption,
    saveJobPlanPrice,
    savePlanOptionPrice,
    saveSequenceSheetPhase,
    deactivateSequenceSheetPhase,
  }), [
    canManageJobs,
    createJobPlan,
    createPlanOption,
    createJob,
    deactivateJobPlan,
    deactivatePlanOption,
    deactivateJob,
    error,
    jobs,
    loading,
    refreshJobs,
    saveJobPlanPrice,
    savePlanOptionPrice,
    saveSequenceSheetPhase,
    deactivateSequenceSheetPhase,
    updateJobPlan,
    updatePlanOption,
    updateJob,
  ])

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}
