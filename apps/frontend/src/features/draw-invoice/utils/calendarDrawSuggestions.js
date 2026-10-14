import { resolveBillingCutoffDate } from '../services/drawInvoicePackageRecord.js'
import {
  buildBilledHardwareCharges,
  buildOptionChargeContext,
  buildUsedDrawSelections,
  drawSelectionKey,
  hardwareChargeKey,
  summarizeDrawPackage,
} from './drawPackages.js'
import { addLag, normalizeLag } from '../../builder-draw-schedules/utils/drawLag.js'
import {
  getHardwareBillingMode,
  getHardwareEventPercentage,
} from './drawWorksheet.js'

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

function compareHardwareSelections(left, right) {
  return String(left.phaseId).localeCompare(String(right.phaseId), 'en', {
    numeric: true,
    sensitivity: 'base',
  })
    || String(left.lotId).localeCompare(String(right.lotId), 'en', {
      numeric: true,
      sensitivity: 'base',
    })
    || EVENT_TYPE_ORDER.indexOf(left.eventType)
      - EVENT_TYPE_ORDER.indexOf(right.eventType)
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

function estimateInvoiceAmount(
  selections,
  hardwareSelections,
  job,
  phases,
  schedule,
  packages,
) {
  if (selections.length === 0 && hardwareSelections.length === 0) return 0

  const optionContext = buildOptionChargeContext(
    packages,
    job?.id,
    schedule?.optionsBillingDrawIndex ?? null,
  )
  const summary = summarizeDrawPackage({
    selections,
    hardwareSelections,
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
    eligibleHardwareCandidates: [],
    eligibleHardwareSelections: [],
    suggestedHardwareSelections: [],
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

export function hardwareCalendarSelectionKey(phaseId, lotId, eventType) {
  return `${phaseId}:${lotId}:${eventType}`
}

export function buildAvailableSeparateHardwareSelections({ job, schedule }) {
  if (!job || getHardwareBillingMode(schedule) !== 'BY_EVENT') return []

  const configuredEventTypes = EVENT_TYPE_ORDER.filter(
    (eventType) => getHardwareEventPercentage(schedule, eventType) > 0,
  )

  return (job.sequenceSheet?.phases ?? []).flatMap((phase) => (
    (phase.lots ?? []).flatMap((lot) => (
      lot.isUtilityBuilding
        ? []
        : configuredEventTypes.map((eventType) => ({
            phaseId: phase.id,
            lotId: lot.id,
            eventType,
          }))
    ))
  ))
}

export function buildDrawCalendarHeadings({
  activities = [],
  job,
  phase,
  schedule,
}) {
  const draws = schedule?.draws ?? []
  const phaseLotIds = new Set(
    (phase?.lots ?? []).map(({ id }) => String(id)),
  )

  return draws.map((draw) => {
    const eventType = EVENT_TYPE_ORDER.includes(draw.eventType)
      ? draw.eventType
      : null
    const lag = normalizeLag(draw.lag)
    if (!job || !phase || !eventType || phaseLotIds.size === 0) {
      return { eventType, eventDates: [] }
    }

    const eventDates = new Set()
    for (const activity of activities) {
      if (
        activity.status !== 'ACTIVE'
        || String(activity.jobId) !== String(job.id)
        || String(activity.phaseId) !== String(phase.id)
      ) continue

      for (const stage of activity.stages ?? []) {
        if (stage.isEnabled === false || stage.type !== eventType) continue

        for (const productionSchedule of stage.schedules ?? []) {
          if (
            productionSchedule.isActive === false
            || !parseDateKey(productionSchedule.date)
            || !(productionSchedule.lotIds ?? []).some(
              (lotId) => phaseLotIds.has(String(lotId)),
            )
          ) continue

          eventDates.add(productionSchedule.date)
        }
      }
    }

    const sortedDates = [...eventDates].sort()
    // Only a Draw with a lag says when it becomes billable; the others keep the
    // plain event dates.
    return lag
      ? {
          eventType,
          eventDates: sortedDates,
          lag,
          availableDates: sortedDates.map((date) => addLag(date, lag)),
        }
      : { eventType, eventDates: sortedDates }
  })
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
    new Set((phase.lots ?? [])
      .filter((lot) => !lot.isUtilityBuilding)
      .map((lot) => String(lot.id))),
  ]))
  const drawIndexesByEventType = new Map()

  for (const [drawIndex, draw] of (schedule.draws ?? []).entries()) {
    if (!EVENT_TYPE_ORDER.includes(draw.eventType)) continue
    const indexes = drawIndexesByEventType.get(draw.eventType) ?? []
    indexes.push(drawIndex)
    drawIndexesByEventType.set(draw.eventType, indexes)
  }

  const usedSelections = buildUsedDrawSelections(packages)
  const billedHardwareCharges = buildBilledHardwareCharges(packages, job.id)
  const hardwareBillingMode = getHardwareBillingMode(schedule)
  const candidatesByKey = new Map()
  const hardwareCandidatesByKey = new Map()

  for (const activity of activities) {
    if (
      activity.status !== 'ACTIVE'
      || String(activity.jobId) !== String(job.id)
      || !phaseLots.has(String(activity.phaseId))
    ) continue

    const lotIdsInPhase = phaseLots.get(String(activity.phaseId))
    for (const stage of activity.stages ?? []) {
      if (stage.isEnabled === false || !EVENT_TYPE_ORDER.includes(stage.type)) continue
      const drawIndexes = drawIndexesByEventType.get(stage.type) ?? []
      const hardwarePercentage = hardwareBillingMode === 'BY_EVENT'
        ? getHardwareEventPercentage(schedule, stage.type)
        : 0

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
              // A Draw with a lag is billable that long after its event.
              billableDate: addLag(
                productionSchedule.date,
                schedule.draws?.[drawIndex]?.lag,
              ),
              activityId: activity.id,
              scheduleId: productionSchedule.id,
            }
            const existing = candidatesByKey.get(key)
            if (!existing || candidate.eventDate < existing.eventDate) {
              candidatesByKey.set(key, candidate)
            }
          }

          if (
            hardwarePercentage > 0
            && !billedHardwareCharges.has(
              hardwareChargeKey(lotId, 'BY_EVENT', stage.type),
            )
          ) {
            const key = hardwareCalendarSelectionKey(
              activity.phaseId,
              lotId,
              stage.type,
            )
            const candidate = {
              key,
              phaseId: activity.phaseId,
              lotId,
              eventType: stage.type,
              eventDate: productionSchedule.date,
              billableDate: productionSchedule.date,
              activityId: activity.id,
              scheduleId: productionSchedule.id,
            }
            const existing = hardwareCandidatesByKey.get(key)
            if (!existing || candidate.eventDate < existing.eventDate) {
              hardwareCandidatesByKey.set(key, candidate)
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
    .filter((candidate) => candidate.billableDate <= latestEligibleDate)
    .sort((left, right) => left.billableDate.localeCompare(right.billableDate)
      || compareSelections(left, right))
  const eligibleSelections = eligibleCandidates
    .map(({ phaseId, lotId, drawIndex }) => ({ phaseId, lotId, drawIndex }))
    .sort(compareSelections)
  const eligibleHardwareCandidates = [...hardwareCandidatesByKey.values()]
    .filter((candidate) => candidate.billableDate <= latestEligibleDate)
    .sort((left, right) => left.billableDate.localeCompare(right.billableDate)
      || compareHardwareSelections(left, right))
  const eligibleHardwareSelections = eligibleHardwareCandidates
    .map(({ phaseId, lotId, eventType }) => ({ phaseId, lotId, eventType }))
    .sort(compareHardwareSelections)
  const eventTypes = EVENT_TYPE_ORDER.filter((eventType) =>
    eligibleCandidates.some((candidate) => candidate.eventType === eventType)
    || eligibleHardwareCandidates.some((candidate) => candidate.eventType === eventType))

  if (mode === 'CUTOFF') {
    return {
      mode,
      cutoffDate,
      windowStart: null,
      windowEnd: null,
      eligibleCandidates,
      eligibleSelections,
      eligibleHardwareCandidates,
      eligibleHardwareSelections,
      suggestedSelections: eligibleSelections,
      suggestedHardwareSelections: eligibleHardwareSelections,
      estimatedInvoiceAmount: estimateInvoiceAmount(
        eligibleSelections,
        eligibleHardwareSelections,
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
    [...eligibleCandidates, ...eligibleHardwareCandidates]
      .map(({ billableDate }) => billableDate),
  )].sort()

  for (const windowEnd of windowEnds) {
    const windowStart = addDays(windowEnd, -13)
    const windowCandidates = eligibleCandidates.filter(
      ({ billableDate }) => billableDate >= windowStart && billableDate <= windowEnd,
    )
    const selections = windowCandidates
      .map(({ phaseId, lotId, drawIndex }) => ({ phaseId, lotId, drawIndex }))
      .sort(compareSelections)
    const hardwareSelections = eligibleHardwareCandidates
      .filter(({ billableDate }) => billableDate >= windowStart && billableDate <= windowEnd)
      .map(({ phaseId, lotId, eventType }) => ({ phaseId, lotId, eventType }))
      .sort(compareHardwareSelections)
    const estimatedInvoiceAmount = estimateInvoiceAmount(
      selections,
      hardwareSelections,
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
        && selections.length + hardwareSelections.length
          > bestWindow.selections.length + bestWindow.hardwareSelections.length
      )
      || (
        amountCents === bestAmountCents
        && selections.length + hardwareSelections.length
          === bestWindow.selections.length + bestWindow.hardwareSelections.length
        && windowStart < bestWindow.windowStart
      )
    ) {
      bestWindow = {
        windowStart,
        windowEnd,
        selections,
        hardwareSelections,
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
    eligibleHardwareCandidates,
    eligibleHardwareSelections,
    suggestedSelections: bestWindow?.selections ?? [],
    suggestedHardwareSelections: bestWindow?.hardwareSelections ?? [],
    estimatedInvoiceAmount: bestWindow?.estimatedInvoiceAmount ?? 0,
    eventTypes,
  }
}
