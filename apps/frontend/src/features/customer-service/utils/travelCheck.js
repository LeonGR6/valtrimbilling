// What the day-before traffic check found (fit plan, block R6; on screen only, decision
// D6). The Edge Function customer-service-travel-check refreshed the legs of that date
// with traffic; the margins are computed here from those saved minutes, with the same
// rule the planner uses.
import { customerServiceMinimumMarginMinutes } from './customerServiceScheduling.js'
import { getCustomerServiceClock } from './dates.js'
import { scheduledDelayMargins, scheduledLegKeys } from './proposalDraft.js'

// The next checked visit date from today on.
export function upcomingTravelCheck(travelChecks = [], now = new Date()) {
  const today = getCustomerServiceClock(now).date
  return [...travelChecks].filter((run) => run.targetDate >= today)
    .sort((left, right) => left.targetDate.localeCompare(right.targetDate))[0] ?? null
}

// Visits of the checked date with less than the minimum margin (tightest first), those
// whose margin is unknown because a leg has no minutes, and legs typed by hand that are
// shorter than what Google gave for that departure (decision P5).
export function travelCheckSummary({ check, requests, technicians, travelMinutes = {}, manualChecks = {} }) {
  const margins = scheduledDelayMargins({ requests, technicians, date: check.targetDate, travelMinutes })
  const numbers = new Map(requests.map((request) => [String(request.id), request.requestNumber]))
  const visits = Object.entries(margins).map(([requestId, margin]) => ({
    requestId, requestNumber: numbers.get(requestId) ?? `Request ${requestId}`, margin,
  }))
  return {
    targetDate: check.targetDate,
    checkedAt: check.checkedAt,
    failedLegs: check.failed ?? 0,
    visits: visits.length,
    tight: visits.filter((visit) => visit.margin !== null && visit.margin < customerServiceMinimumMarginMinutes)
      .sort((left, right) => left.margin - right.margin),
    unknown: visits.filter((visit) => visit.margin === null)
      .sort((left, right) => String(left.requestNumber).localeCompare(String(right.requestNumber))),
    manualBelowGoogle: scheduledLegKeys({ requests, technicians, date: check.targetDate })
      .filter((key) => manualChecks[key] && manualChecks[key].googleMinutes > manualChecks[key].minutes)
      .map((key) => {
        const [fromId, toId] = key.split('>')
        return {
          key,
          from: numbers.get(fromId) ?? `Request ${fromId}`,
          to: numbers.get(toId) ?? `Request ${toId}`,
          minutes: manualChecks[key].minutes,
          googleMinutes: manualChecks[key].googleMinutes,
        }
      }),
  }
}
