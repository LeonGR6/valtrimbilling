import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  deactivateBuilderBillingSetup as deactivateBuilderBillingSetupRecord,
  listBuilderBillingSetups,
  saveBuilderBillingSetup as saveBuilderBillingSetupRecord,
} from '../services/builderBillingSetupsRepository.js'
import { BuilderDrawSchedulesContext } from './builderDrawSchedulesContext.js'

export function BuilderDrawSchedulesProvider({ children }) {
  const { profile } = useAuth()
  const [builderDrawSchedules, setBuilderDrawSchedules] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canManageBuilderBillingSetups = ['ADMIN', 'PROJECT_MANAGEMENT'].includes(
    profile?.role,
  )

  const refreshBuilderBillingSetups = useCallback(async () => {
    if (!profile?.id) {
      setBuilderDrawSchedules([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const records = await listBuilderBillingSetups()
      setBuilderDrawSchedules(records)
      setError(null)
      return records
    } catch (loadError) {
      setError(loadError.message)
      throw loadError
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) {
      // Authentication is the source of truth for clearing financial settings.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBuilderDrawSchedules([])
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
    loading,
    error,
    canManageBuilderBillingSetups,
    refreshBuilderBillingSetups,
    saveBuilderBillingSetup,
    deactivateBuilderBillingSetup,
  }), [
    builderDrawSchedules,
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
