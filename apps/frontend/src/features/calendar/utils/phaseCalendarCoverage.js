// Which Phases of a Job already have Production events in the Calendar.
//
// A Production activity always creates EXT, DM and HW together (HW is what the
// Builder's Separate Hardware is billed against), and cancelling it removes all
// of them, so a Phase either has Calendar events or it has none: there is no
// per-type gap to report.

const byText = (left, right) => String(left ?? '').localeCompare(
  String(right ?? ''),
  'en',
  { numeric: true, sensitivity: 'base' },
)

export function phaseCoverageKey(jobId, phaseId) {
  return `${jobId}:${phaseId}`
}

/** Phases that can be scheduled: the ones with at least one Lot (not Utility). */
export function getSchedulablePhases(job) {
  return (job?.sequenceSheet?.phases ?? []).filter(
    (phase) => (phase.lots ?? []).some((lot) => !lot.isUtilityBuilding),
  )
}

function activityHasEvents(activity) {
  return activity.status === 'ACTIVE'
    && (activity.stages ?? []).some((stage) => (
      stage.isEnabled !== false
      && (stage.schedules ?? []).some(
        (schedule) => schedule.isActive !== false && Boolean(schedule.date),
      )
    ))
}

export function buildPhaseCalendarCoverage({ jobs = [], activities = [] }) {
  const scheduledKeys = new Set(
    activities
      .filter(activityHasEvents)
      .map((activity) => phaseCoverageKey(activity.jobId, activity.phaseId)),
  )
  const unscheduled = []
  const unscheduledCountByJob = new Map()

  for (const job of jobs) {
    if (job?.isActive === false) continue

    for (const phase of getSchedulablePhases(job)) {
      if (scheduledKeys.has(phaseCoverageKey(job.id, phase.id))) continue

      unscheduled.push({
        key: phaseCoverageKey(job.id, phase.id),
        job,
        phase,
        lotCount: (phase.lots ?? []).filter((lot) => !lot.isUtilityBuilding).length,
      })
      unscheduledCountByJob.set(
        String(job.id),
        (unscheduledCountByJob.get(String(job.id)) ?? 0) + 1,
      )
    }
  }

  unscheduled.sort((left, right) => byText(left.job.builder, right.job.builder)
    || byText(left.job.community, right.job.community)
    || byText(left.job.code, right.job.code)
    || byText(left.phase.name, right.phase.name)
    || byText(left.phase.building, right.phase.building))

  return {
    unscheduled,
    unscheduledCountByJob,
    /** 'scheduled', 'unscheduled', or null when the Phase cannot be scheduled. */
    statusOf: (job, phase) => {
      if (job?.isActive === false || !getSchedulablePhases(job).some(
        (candidate) => String(candidate.id) === String(phase?.id),
      )) return null

      return scheduledKeys.has(phaseCoverageKey(job.id, phase.id))
        ? 'scheduled'
        : 'unscheduled'
    },
  }
}

const PRODUCTION_TYPE_ORDER = ['EXT', 'SHUTTER', 'DM', 'HW']

/**
 * The Phases to offer when scheduling: the ones with no events yet first, the
 * ones already on the Calendar after them. Each group keeps its own order.
 * `statusOf` is the coverage lookup; a Phase whose status is unknown (data not
 * loaded) counts as not scheduled.
 */
export function sortPhasesForScheduling(phases, statusOf) {
  const scheduled = []
  const pending = []

  for (const phase of phases) {
    ;(statusOf(phase) === 'scheduled' ? scheduled : pending).push(phase)
  }

  return { pending, scheduled }
}

/**
 * The events a Phase already has in the Calendar, one entry per type (EXT,
 * Shutter, DM, HW) with its earliest date and how many dates it has. Install
 * only and lock up dates are extras of those, so they are not listed.
 *
 * @param events Calendar events as the Production activities context builds them
 */
export function existingPhaseEvents(events, jobId, phaseId) {
  const byType = new Map()

  for (const event of events) {
    const props = event.extendedProps ?? {}
    if (
      props.calendarType !== 'PRODUCTION'
      || String(props.jobId) !== String(jobId)
      || String(props.phaseId) !== String(phaseId)
      || !['base', 'division'].includes(props.variant)
      || !PRODUCTION_TYPE_ORDER.includes(props.activityType)
    ) continue

    const current = byType.get(props.activityType)
    if (!current) {
      byType.set(props.activityType, {
        type: props.activityType,
        date: event.start,
        count: 1,
        eventId: event.id,
        activityId: props.activityId ?? null,
      })
    } else {
      current.count += 1
      if (event.start < current.date) {
        current.date = event.start
        current.eventId = event.id
      }
    }
  }

  return PRODUCTION_TYPE_ORDER.filter((type) => byType.has(type)).map((type) => byType.get(type))
}

/** "May 12" ("May 12, 2026" with `withYear`) for an ISO date, without time zone shifts. */
export function formatEventDay(isoDate, withYear = false) {
  const [year, month, day] = String(isoDate ?? '').slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return ''

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear && { year: 'numeric' }),
    timeZone: 'UTC',
  })
}
