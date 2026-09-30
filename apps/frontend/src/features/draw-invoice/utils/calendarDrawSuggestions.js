import { resolveBillingCutoffDate } from '../services/drawInvoicePackageRecord.js'
import {
  buildOptionChargeContext,
  buildUsedDrawSelections,
  drawSelectionKey,
  summarizeDrawPackage,
} from './drawPackages.js'

const DAY_MS = 24 * 60 * 60 * 1000
const EVENT_TYPE_ORDER = ['EXT', 'DM', 'HW']

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

function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey)
  if (!date) return null
  return new Date(date.getTime() + amount * DAY_MS).toISOString().slice(0, 10)
}

function compareSelections(left, right) {
  return String(left.phaseId).localeCompare(String(right.phaseId), 'en', {
    numeric: true,
    sensitivity: 'base',
  })
    || String(left.lotId).localeCompare(String(right.lotId), 'en', {
      numeric: true,
      sensitivity: 'base',
    })
    || left.drawIndex - right.drawIndex
}

function toCutoffSetup(schedule) {
  return {
    frequency: schedule?.frequency,
    cutoff_any_date: Boolean(schedule?.anyDate),
    cutoff_day: schedule?.cutoffDay,
    cutoff_days: schedule?.cutoffDays ?? [],
    cutoff_weekday: schedule?.cutoffWeekday,
  }
}

function estimateInvoiceAmount(selections, job, phases, schedule, packages) {
  if (selections.length === 0) return 0

  const optionContext = buildOptionChargeContext(
    packages,
    job?.id,
    schedule?.optionsBillingDrawIndex ?? null,
  )
  const summary = summarizeDrawPackage({
    selections,
    optionsBillingDrawIndex: schedule?.optionsBillingDrawIndex ?? null,
    ...optionContext,
  }, job, phases, schedule)

  return Number(summary.invoiceAmount) || 0
}

function emptySuggestion(mode, cutoffDate = null) {
  return {
    mode,
    cutoffDate,
    windowStart: null,
    windowEnd: null,
    eligibleCandidates: [],
    eligibleSelections: [],
    suggestedSelections: [],
    estimatedInvoiceAmount: 0,
    eventTypes: [],
  }
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function calendarSelectionKey(phaseId, lotId, drawIndex) {
  return `${phaseId}:${lotId}:${drawIndex}`
}

export function buildCalendarDrawSuggestion({
  activities = [],
  job,
  schedule,
  packages = [],
  asOfDate = localDateKey(),
}) {
  const mode = schedule?.anyDate ? 'ANY_DATE' : 'CUTOFF'
  if (!job || !schedule || !parseDateKey(asOfDate)) {
    return emptySuggestion(mode)
  }

  const phases = job.sequenceSheet?.phases ?? []
  const phaseLots = new Map(phases.map((phase) => [
    String(phase.id),
    new Set((phase.lots ?? []).map((lot) => String(lot.id))),
  ]))
  const drawIndexesByEventType = new Map()

  for (const [drawIndex, draw] of (schedule.draws ?? []).entries()) {
    if (!EVENT_TYPE_ORDER.includes(draw.eventType)) continue
    const indexes = drawIndexesByEventType.get(draw.eventType) ?? []
    indexes.push(drawIndex)
    drawIndexesByEventType.set(draw.eventType, indexes)
  }

  const usedSelections = buildUsedDrawSelections(packages)
  const candidatesByKey = new Map()

  for (const activity of activities) {
    if (
      activity.status !== 'ACTIVE'
      || String(activity.jobId) !== String(job.id)
      || !phaseLots.has(String(activity.phaseId))
    ) continue

    const lotIdsInPhase = phaseLots.get(String(activity.phaseId))
    for (const stage of activity.stages ?? []) {
      if (stage.isEnabled === false) continue
      const drawIndexes = drawIndexesByEventType.get(stage.type) ?? []
      if (drawIndexes.length === 0) continue

      for (const productionSchedule of stage.schedules ?? []) {
        if (productionSchedule.isActive === false || !parseDateKey(productionSchedule.date)) {
          continue
        }

        for (const lotId of productionSchedule.lotIds ?? []) {
          if (!lotIdsInPhase.has(String(lotId))) continue

          for (const drawIndex of drawIndexes) {
            const usedKey = drawSelectionKey(
              job.id,
              activity.phaseId,
              lotId,
              drawIndex,
            )
            if (usedSelections.has(usedKey)) continue

            const key = calendarSelectionKey(activity.phaseId, lotId, drawIndex)
            const candidate = {
              key,
              phaseId: activity.phaseId,
              lotId,
              drawIndex,
              eventType: stage.type,
              eventDate: productionSchedule.date,
              activityId: activity.id,
              scheduleId: productionSchedule.id,
            }
            const existing = candidatesByKey.get(key)
            if (!existing || candidate.eventDate < existing.eventDate) {
              candidatesByKey.set(key, candidate)
            }
          }
        }
      }
    }
  }

  const cutoffDate = mode === 'CUTOFF'
    ? resolveBillingCutoffDate(asOfDate, toCutoffSetup(schedule))
    : null
  const latestEligibleDate = mode === 'ANY_DATE' ? asOfDate : cutoffDate
  if (!latestEligibleDate) return emptySuggestion(mode, cutoffDate)

  const eligibleCandidates = [...candidatesByKey.values()]
    .filter((candidate) => candidate.eventDate <= latestEligibleDate)
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate)
      || compareSelections(left, right))
  const eligibleSelections = eligibleCandidates
    .map(({ phaseId, lotId, drawIndex }) => ({ phaseId, lotId, drawIndex }))
    .sort(compareSelections)
  const eventTypes = EVENT_TYPE_ORDER.filter((eventType) =>
    eligibleCandidates.some((candidate) => candidate.eventType === eventType))

  if (mode === 'CUTOFF') {
    return {
      mode,
      cutoffDate,
      windowStart: null,
      windowEnd: null,
      eligibleCandidates,
      eligibleSelections,
      suggestedSelections: eligibleSelections,
      estimatedInvoiceAmount: estimateInvoiceAmount(
        eligibleSelections,
        job,
        phases,
        schedule,
        packages,
      ),
      eventTypes,
    }
  }

  let bestWindow = null
  const windowEnds = [...new Set(
    eligibleCandidates.map(({ eventDate }) => eventDate),
  )].sort()

  for (const windowEnd of windowEnds) {
    const windowStart = addDays(windowEnd, -13)
    const windowCandidates = eligibleCandidates.filter(
      ({ eventDate }) => eventDate >= windowStart && eventDate <= windowEnd,
    )
    const selections = windowCandidates
      .map(({ phaseId, lotId, drawIndex }) => ({ phaseId, lotId, drawIndex }))
      .sort(compareSelections)
    const estimatedInvoiceAmount = estimateInvoiceAmount(
      selections,
      job,
      phases,
      schedule,
      packages,
    )
    const amountCents = Math.round(estimatedInvoiceAmount * 100)
    const bestAmountCents = Math.round(
      (bestWindow?.estimatedInvoiceAmount ?? -1) * 100,
    )

    if (
      bestWindow === null
      || amountCents > bestAmountCents
      || (
        amountCents === bestAmountCents
        && selections.length > bestWindow.selections.length
      )
      || (
        amountCents === bestAmountCents
        && selections.length === bestWindow.selections.length
        && windowStart < bestWindow.windowStart
      )
    ) {
      bestWindow = {
        windowStart,
        windowEnd,
        selections,
        estimatedInvoiceAmount,
      }
    }
  }

  return {
    mode,
    cutoffDate: null,
    windowStart: bestWindow?.windowStart ?? null,
    windowEnd: bestWindow?.windowEnd ?? null,
    eligibleCandidates,
    eligibleSelections,
    suggestedSelections: bestWindow?.selections ?? [],
    estimatedInvoiceAmount: bestWindow?.estimatedInvoiceAmount ?? 0,
    eventTypes,
  }
}
