import { useMemo } from 'react'
import { useJobs } from '../../jobs/context/useJobs.js'
import { useProductionActivities } from '../context/useProductionActivities.js'
import { buildPhaseCalendarCoverage } from '../utils/phaseCalendarCoverage.js'

/**
 * Phases without Calendar events. `ready` is false until the Jobs and the
 * Production activities have loaded (or when either failed), so a screen never
 * flags every Phase as unscheduled while data is still on its way.
 */
export function usePhaseCalendarCoverage() {
  const { jobs, loading: jobsLoading, error: jobsError } = useJobs()
  const {
    activities,
    loaded,
    loading: activitiesLoading,
    error: activitiesError,
  } = useProductionActivities()

  const coverage = useMemo(
    () => buildPhaseCalendarCoverage({ jobs, activities }),
    [activities, jobs],
  )
  const error = jobsError || activitiesError || null
  const ready = loaded && !jobsLoading && !activitiesLoading && !error

  return { ready, error, ...coverage }
}
