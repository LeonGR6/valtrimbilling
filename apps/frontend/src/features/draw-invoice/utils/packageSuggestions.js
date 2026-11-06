import { getJobBuilderId } from '../../jobs/utils/jobRoutes.js'
import { buildCalendarDrawSuggestion } from './calendarDrawSuggestions.js'
import {
  buildOptionChargeContext,
  summarizeDrawPackage,
} from './drawPackages.js'
import { buildDrawWorksheet } from './drawWorksheet.js'

const DAY_MS = 24 * 60 * 60 * 1000

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null

  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )
  const date = new Date(milliseconds)
  return date.toISOString().slice(0, 10) === value ? date : null
}

export function countBusinessDaysThroughCutoff(asOfDate, cutoffDate) {
  const start = parseDateKey(asOfDate)
  const end = parseDateKey(cutoffDate)
  if (!start || !end || start > end) return null

  let businessDays = 0
  for (
    let cursor = start.getTime();
    cursor <= end.getTime();
    cursor += DAY_MS
  ) {
    const weekday = new Date(cursor).getUTCDay()
    if (weekday >= 1 && weekday <= 5) businessDays += 1
  }

  return businessDays
}

export function resolveJobBillingSchedule(
  job,
  schedules = [],
  jobBillingSetupVersions = [],
) {
  return jobBillingSetupVersions.find(
    (candidate) => String(candidate.id) === String(job?.billingSetupVersionId),
  ) ?? schedules.find(
    (candidate) => String(candidate.builderId) === String(getJobBuilderId(job)),
  ) ?? null
}

function comparePackageSuggestions(left, right) {
  if (left.mode !== right.mode) return left.mode === 'CUTOFF' ? -1 : 1

  return String(left.cutoffDate ?? '').localeCompare(String(right.cutoffDate ?? ''))
    || String(left.job.builder ?? '').localeCompare(
      String(right.job.builder ?? ''),
      'en',
      { numeric: true, sensitivity: 'base' },
    )
    || String(left.job.code ?? '').localeCompare(
      String(right.job.code ?? ''),
      'en',
      { numeric: true, sensitivity: 'base' },
    )
}

// A missed cutoff is work left behind, not a cutoff that is coming up: the countdowns
// (Home, the menu badge) only count the upcoming ones.
export function selectUpcomingCutoffSuggestions(suggestions = [], limit = 3) {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 3

  return suggestions
    .filter((suggestion) => (
      suggestion?.mode === 'CUTOFF'
      && suggestion.cutoffDate
      && !suggestion.isMissedCutoff
    ))
    .sort(comparePackageSuggestions)
    .slice(0, normalizedLimit)
}

function hasSelections(suggestion) {
  return suggestion.suggestedSelections.length > 0
    || suggestion.suggestedHardwareSelections.length > 0
}

export function buildPackageSuggestions({
  jobs = [],
  schedules = [],
  jobBillingSetupVersions = [],
  packages = [],
  productionActivities = [],
  asOfDate,
  maxBusinessDays = 5,
}) {
  if (!parseDateKey(asOfDate)) return []

  return jobs.flatMap((job) => {
    if (job?.isActive === false) return []

    const schedule = resolveJobBillingSchedule(
      job,
      schedules,
      jobBillingSetupVersions,
    )
    if (!schedule) return []

    const suggestionInput = {
      activities: productionActivities,
      job,
      schedule,
      packages,
      asOfDate,
    }
    let calendarSuggestion = buildCalendarDrawSuggestion(suggestionInput)
    let businessDaysRemaining = null
    let nextCutoffDate = null

    if (calendarSuggestion.mode === 'CUTOFF') {
      nextCutoffDate = calendarSuggestion.cutoffDate
      businessDaysRemaining = countBusinessDaysThroughCutoff(
        asOfDate,
        calendarSuggestion.cutoffDate,
      )
      const insideWindow = businessDaysRemaining != null
        && businessDaysRemaining <= maxBusinessDays

      if (!insideWindow) {
        // The next cutoff is still far away. What was ready by the last cutoff and is still
        // unbilled is not waiting for it: it is shown as a missed cutoff.
        calendarSuggestion = buildCalendarDrawSuggestion({
          ...suggestionInput,
          missedCutoff: true,
        })
        businessDaysRemaining = null
      }
    }
    if (!hasSelections(calendarSuggestion)) return []

    const selectedPhaseIds = new Set(
      [
        ...calendarSuggestion.suggestedSelections,
        ...calendarSuggestion.suggestedHardwareSelections,
      ].map(({ phaseId }) => String(phaseId)),
    )
    const phases = (job.sequenceSheet?.phases ?? []).filter(
      (phase) => selectedPhaseIds.has(String(phase.id)),
    )
    if (phases.length === 0) return []

    const optionContext = buildOptionChargeContext(
      packages,
      job.id,
      schedule.optionsBillingDrawIndex ?? null,
    )
    const summary = summarizeDrawPackage({
      selections: calendarSuggestion.suggestedSelections,
      hardwareSelections: calendarSuggestion.suggestedHardwareSelections,
      optionsBillingDrawIndex: schedule.optionsBillingDrawIndex ?? null,
      ...optionContext,
    }, job, phases, schedule)
    const needsWorksheetReview = phases.some(
      (phase) => !buildDrawWorksheet(job, phase, schedule).isReady,
    )
    const unpricedOptionCount = summary.unpricedOptionCount
    const isReady = !needsWorksheetReview && unpricedOptionCount === 0

    return [{
      job,
      schedule,
      phases,
      initialPhaseId: calendarSuggestion.suggestedSelections[0]?.phaseId
        ?? calendarSuggestion.suggestedHardwareSelections[0]?.phaseId
        ?? phases[0].id,
      mode: calendarSuggestion.mode,
      cutoffDate: calendarSuggestion.cutoffDate,
      // Work ready by a cutoff that already went by and is still unbilled.
      isMissedCutoff: calendarSuggestion.isMissedCutoff,
      // The cutoff that is coming (for a missed one, cutoffDate is the past cutoff).
      nextCutoffDate,
      windowStart: calendarSuggestion.windowStart,
      windowEnd: calendarSuggestion.windowEnd,
      businessDaysRemaining,
      isCutoffToday: calendarSuggestion.cutoffDate === asOfDate,
      selectionCount: calendarSuggestion.suggestedSelections.length
        + calendarSuggestion.suggestedHardwareSelections.length,
      drawSelectionCount: calendarSuggestion.suggestedSelections.length,
      hardwareSelectionCount: calendarSuggestion.suggestedHardwareSelections.length,
      eventTypes: calendarSuggestion.eventTypes,
      estimatedInvoiceAmount: calendarSuggestion.estimatedInvoiceAmount,
      needsWorksheetReview,
      unpricedOptionCount,
      isReady,
    }]
  }).sort(comparePackageSuggestions)
}

/** Package Suggestions of Jobs whose fixed cutoff is inside the window (not the missed ones). */
export function buildUpcomingCutoffSuggestions(options) {
  return buildPackageSuggestions(options).filter(
    (suggestion) => suggestion.mode === 'CUTOFF' && !suggestion.isMissedCutoff,
  )
}
