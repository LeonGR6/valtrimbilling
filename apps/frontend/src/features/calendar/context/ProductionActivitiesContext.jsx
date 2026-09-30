import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { createProductionCalendarEvents } from '../data/calendarEvents.js'
import {
  cancelProductionActivity as cancelProductionActivityRecord,
  listProductionActivities,
  saveProductionActivity as saveProductionActivityRecord,
} from '../services/productionActivitiesRepository.js'
import { toProductionActivityDraft } from '../services/productionActivityRecord.js'
import { ProductionActivitiesContext } from './productionActivitiesContext.js'

function createActivityEvents(activity, jobs) {
  const draft = toProductionActivityDraft(activity, jobs)
  return draft
    ? createProductionCalendarEvents(draft, `production-${activity.id}`, activity.id)
    : []
}

export function ProductionActivitiesProvider({ children }) {
  const { profile } = useAuth()
  const { jobs } = useJobs()
  const [activityRecords, setActivityRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canManageProductionActivities = [
    'ADMIN',
    'PROJECT_MANAGEMENT',
    'SCHEDULING',
  ].includes(profile?.role)

  const events = useMemo(
    () => activityRecords.flatMap((activity) => createActivityEvents(activity, jobs)),
    [activityRecords, jobs],
  )

  const refreshProductionActivities = useCallback(async () => {
    if (!profile?.id) {
      setActivityRecords([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const activities = await listProductionActivities()
      setActivityRecords(activities)
      setError(null)
      return activities
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
      setActivityRecords([])
      setError(null)
      setLoading(false)
      return undefined
    }

    refreshProductionActivities().catch(() => {})
    return undefined
  }, [profile?.id, refreshProductionActivities])

  const saveProductionActivity = useCallback(async (values) => {
    setLoading(true)
    try {
      const { saved, activities } = await saveProductionActivityRecord(values)
      setActivityRecords(activities)
      setError(null)
      return {
        saved,
        events: createActivityEvents(saved, jobs),
      }
    } catch (saveError) {
      setError(saveError.message)
      throw saveError
    } finally {
      setLoading(false)
    }
  }, [jobs])

  const cancelProductionActivity = useCallback(async (activityId) => {
    setLoading(true)
    try {
      const { cancelledActivityId, activities } = await cancelProductionActivityRecord(activityId)
      setActivityRecords(activities)
      setError(null)
      return cancelledActivityId
    } catch (cancelError) {
      setError(cancelError.message)
      throw cancelError
    } finally {
      setLoading(false)
    }
  }, [])

  const value = useMemo(() => ({
    activities: activityRecords,
    events,
    loading,
    error,
    canManageProductionActivities,
    refreshProductionActivities,
    saveProductionActivity,
    cancelProductionActivity,
  }), [
    activityRecords,
    cancelProductionActivity,
    canManageProductionActivities,
    error,
    events,
    loading,
    refreshProductionActivities,
    saveProductionActivity,
  ])

  return (
    <ProductionActivitiesContext.Provider value={value}>
      {children}
    </ProductionActivitiesContext.Provider>
  )
}
