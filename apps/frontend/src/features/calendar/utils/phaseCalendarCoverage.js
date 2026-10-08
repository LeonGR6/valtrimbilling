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
