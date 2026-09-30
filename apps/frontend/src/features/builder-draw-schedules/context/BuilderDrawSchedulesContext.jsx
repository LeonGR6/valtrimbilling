import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import {
  deactivateBuilderBillingSetup as deactivateBuilderBillingSetupRecord,
  listBuilderBillingSetups,
  listJobBillingSetupVersions,
  saveBuilderBillingSetup as saveBuilderBillingSetupRecord,
} from '../services/builderBillingSetupsRepository.js'
import { BuilderDrawSchedulesContext } from './builderDrawSchedulesContext.js'

export function BuilderDrawSchedulesProvider({ children }) {
  const { profile } = useAuth()
  const { jobs } = useJobs()
  const [builderDrawSchedules, setBuilderDrawSchedules] = useState([])
  const [jobBillingSetupVersions, setJobBillingSetupVersions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canManageBuilderBillingSetups = ['ADMIN', 'PROJECT_MANAGEMENT'].includes(
    profile?.role,
  )
  const jobBillingSetupVersionKey = useMemo(() => [...new Set(
    jobs.map(({ billingSetupVersionId }) => Number(billingSetupVersionId))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right).join(','), [jobs])

  const refreshBuilderBillingSetups = useCallback(async () => {
    if (!profile?.id) {
      setBuilderDrawSchedules([])
      setJobBillingSetupVersions([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const [records, jobVersions] = await Promise.all([
        listBuilderBillingSetups(),
        listJobBillingSetupVersions(
          jobBillingSetupVersionKey ? jobBillingSetupVersionKey.split(',') : [],
        ),
      ])
      setBuilderDrawSchedules(records)
      setJobBillingSetupVersions(jobVersions)
      setError(null)
      return records
    } catch (loadError) {
      setError(loadError.message)
      throw loadError
    } finally {
      setLoading(false)
    }
  }, [jobBillingSetupVersionKey, profile?.id])

  useEffect(() => {
    if (!profile?.id) {
      // Authentication is the source of truth for clearing financial settings.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBuilderDrawSchedules([])
      setJobBillingSetupVersions([])
      setError(null)
      setLoading(false)
      return undefined
    }

    refreshBuilderBillingSetups().catch(() => {})
    return undefined
  }, [profile?.id, refreshBuilderBillingSetups])

  const saveBuilderBillingSetup = useCallback(async (schedule) => {
    const saved = await saveBuilderBillingSetupRecord(schedule)
    setBuilderDrawSchedules((current) => [
      ...current.filter((item) => item.builderId !== saved.builderId),
      saved,
    ].sort((left, right) => left.builderId - right.builderId))
    setError(null)
    return saved
  }, [])

  const deactivateBuilderBillingSetup = useCallback(async (builderId) => {
    await deactivateBuilderBillingSetupRecord(builderId)
    setBuilderDrawSchedules((current) => current.filter(
      (item) => item.builderId !== builderId,
    ))
    setError(null)
  }, [])

  const value = useMemo(() => ({
    builderDrawSchedules,
    jobBillingSetupVersions,
    loading,
    error,
    canManageBuilderBillingSetups,
    refreshBuilderBillingSetups,
    saveBuilderBillingSetup,
    deactivateBuilderBillingSetup,
  }), [
    builderDrawSchedules,
    jobBillingSetupVersions,
    canManageBuilderBillingSetups,
    deactivateBuilderBillingSetup,
    error,
    loading,
    refreshBuilderBillingSetups,
    saveBuilderBillingSetup,
  ])

  return (
    <BuilderDrawSchedulesContext.Provider value={value}>
      {children}
    </BuilderDrawSchedulesContext.Provider>
  )
}
