import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../features/auth/context/useAuth.js'
import { useBuilderDrawSchedules } from '../../../features/builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { useProductionActivities } from '../../../features/calendar/context/useProductionActivities.js'
import { usePhaseCalendarCoverage } from '../../../features/calendar/hooks/usePhaseCalendarCoverage.js'
import { useDrawInvoicePackages } from '../../../features/draw-invoice/context/useDrawInvoicePackages.js'
import { countPackagesMissingRequiredDocuments } from '../../../features/draw-invoice/services/jobDocumentRecord.js'
import { onJobDocumentsChanged } from '../../../features/draw-invoice/services/jobDocumentEvents.js'
import { listJobDocumentLibrary } from '../../../features/draw-invoice/services/jobDocumentsRepository.js'
import { localDateKey } from '../../../features/draw-invoice/utils/calendarDrawSuggestions.js'
import { buildUpcomingCutoffSuggestions } from '../../../features/draw-invoice/utils/packageSuggestions.js'
import { useJobs } from '../../../features/jobs/context/useJobs.js'
import { useCurrentDate } from '../../../hooks/useCurrentDate.js'

const pluralize = (count, singular, plural) => (count === 1 ? singular : plural)

export function describeBadge(count, singular, plural, suffix) {
  return `${count} ${pluralize(count, singular, plural)} ${suffix}`
}

/**
 * Counts of things waiting for someone, keyed by the path of the menu item that
 * leads to them. Only counts above zero are returned.
 */
export function useSidebarBadges({ canSeePackages }) {
  const { profile } = useAuth()
  const { jobs } = useJobs()
  const { activities, loaded: activitiesLoaded } = useProductionActivities()
  const { builderDrawSchedules, jobBillingSetupVersions } = useBuilderDrawSchedules()
  const { drawInvoicePackages } = useDrawInvoicePackages()
  const phaseCoverage = usePhaseCalendarCoverage()
  const [today] = useCurrentDate()
  const [documentLibrary, setDocumentLibrary] = useState(null)
  const userId = profile?.id ?? null

  // Document requirements are only needed to count Packages that still lack them.
  useEffect(() => {
    if (!userId || !canSeePackages || jobs.length === 0) return undefined

    let cancelled = false
    const load = () => {
      listJobDocumentLibrary(jobs)
        .then((library) => {
          if (!cancelled) setDocumentLibrary(library)
        })
        .catch(() => {
          // A badge is a convenience; the Documents tab reports the real error.
        })
    }

    load()
    const stopListening = onJobDocumentsChanged(load)
    return () => {
      cancelled = true
      stopListening()
    }
  }, [canSeePackages, jobs, userId])

  return useMemo(() => {
    const badges = {}

    if (phaseCoverage.ready && phaseCoverage.unscheduled.length > 0) {
      const count = phaseCoverage.unscheduled.length
      badges['/calendar'] = {
        count,
        label: describeBadge(count, 'Phase', 'Phases', 'without Calendar events'),
      }
    }

    if (canSeePackages && activitiesLoaded) {
      const cutoffs = buildUpcomingCutoffSuggestions({
        jobs,
        schedules: builderDrawSchedules,
        jobBillingSetupVersions,
        packages: drawInvoicePackages,
        productionActivities: activities,
        asOfDate: localDateKey(today),
      })
      if (cutoffs.length > 0) {
        badges['/'] = {
          count: cutoffs.length,
          label: describeBadge(cutoffs.length, 'cutoff', 'cutoffs', 'due within 5 business days'),
        }
      }
    }

    if (canSeePackages && documentLibrary) {
      const count = countPackagesMissingRequiredDocuments(
        drawInvoicePackages
          .filter((record) => record.status !== 'CANCELLED')
          .map((record) => record.jobId),
        documentLibrary.documentsByJob,
        documentLibrary.requiredTypeKeysByJob,
      )
      if (count > 0) {
        badges['/draw-invoice'] = {
          count,
          label: describeBadge(count, 'Package', 'Packages', 'missing required documents'),
        }
      }
    }

    return badges
  }, [
    activities,
    activitiesLoaded,
    builderDrawSchedules,
    canSeePackages,
    documentLibrary,
    drawInvoicePackages,
    jobBillingSetupVersions,
    jobs,
    phaseCoverage.ready,
    phaseCoverage.unscheduled.length,
    today,
  ])
}
