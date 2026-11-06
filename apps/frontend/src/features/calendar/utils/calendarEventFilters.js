// Builder / Community / Job filters for the Production calendar. They work on
// the events as the Calendar renders them (`extendedProps`), so they do not
// need the Jobs list and only offer values that have events.

const byText = (left, right) => String(left).localeCompare(String(right), 'en', {
  numeric: true,
  sensitivity: 'base',
})

function inScope(props, { builder = 'ALL', community = 'ALL' }) {
  return (builder === 'ALL' || props.builder === builder)
    && (community === 'ALL' || props.community === community)
}

export function calendarFilterOptions(events = [], { builder = 'ALL', community = 'ALL' } = {}) {
  const allProps = events.map((event) => event.extendedProps ?? {})
  const jobs = new Map()

  for (const props of allProps) {
    if (props.jobId == null || !inScope(props, { builder, community })) continue
    jobs.set(String(props.jobId), `Job #${props.jobCode} · ${props.community}`)
  }

  return {
    builders: [...new Set(allProps.map(({ builder: name }) => name).filter(Boolean))]
      .sort(byText),
    communities: [...new Set(
      allProps
        .filter((props) => builder === 'ALL' || props.builder === builder)
        .map((props) => props.community)
        .filter(Boolean),
    )].sort(byText),
    jobs: [...jobs.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => byText(left.label, right.label)),
  }
}

/** A remembered value that no longer has events falls back to "ALL". */
export function resolveCalendarScope(events, stored) {
  const builderOptions = calendarFilterOptions(events)
  const builder = stored.builder === 'ALL' || builderOptions.builders.includes(stored.builder)
    ? stored.builder
    : 'ALL'
  const communityOptions = calendarFilterOptions(events, { builder })
  const community = stored.community === 'ALL'
    || communityOptions.communities.includes(stored.community)
    ? stored.community
    : 'ALL'
  const jobOptions = calendarFilterOptions(events, { builder, community })
  const jobId = stored.jobId === 'ALL'
    || jobOptions.jobs.some(({ id }) => id === stored.jobId)
    ? stored.jobId
    : 'ALL'

  return { builder, community, jobId, options: jobOptions }
}

export function filterCalendarEvents(events, {
  types,
  builder = 'ALL',
  community = 'ALL',
  jobId = 'ALL',
}) {
  return events.filter((event) => {
    const props = event.extendedProps ?? {}
    return types.includes(props.activityType)
      && inScope(props, { builder, community })
      && (jobId === 'ALL' || String(props.jobId) === String(jobId))
  })
}
