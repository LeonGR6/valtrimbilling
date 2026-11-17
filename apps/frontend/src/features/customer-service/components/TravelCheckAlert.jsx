import { useMemo } from 'react'
import { Alert } from '@mui/material'
import { formatWeekdayDate } from '../utils/dates.js'
import { formatDepartureTime } from '../utils/travelEstimates.js'
import { travelCheckSummary, upcomingTravelCheck } from '../utils/travelCheck.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

// On-screen note of the day-before traffic check (block R6, decision D6: no email).
export default function TravelCheckAlert({ requests }) {
  const { travelChecks, technicians, storedTravelMinutes, manualTravelChecks } = useCustomerServicePrototype()
  const check = upcomingTravelCheck(travelChecks)
  const summary = useMemo(
    () => (check
      ? travelCheckSummary({
        check, requests, technicians, travelMinutes: storedTravelMinutes, manualChecks: manualTravelChecks,
      })
      : null),
    [check, requests, technicians, storedTravelMinutes, manualTravelChecks],
  )
  if (!summary || summary.visits === 0) return null

  const heading = `Traffic checked at ${formatDepartureTime(summary.checkedAt)} for ${formatWeekdayDate(summary.targetDate)}.`
  const notes = [
    summary.late.length
      ? `${summary.late.map((visit) => visit.requestNumber).join(', ')}: with this traffic, a visit would finish`
        + ` ${-summary.late[0].margin} min after its customer window closes. Tell the customer or move a visit to`
        + ' another technician.'
      : `All ${plural(summary.visits, 'visit')} fit inside their customer windows with this traffic.`,
    summary.unknown.length
      ? `${summary.unknown.map((visit) => visit.requestNumber).join(', ')}: a travel leg has no minutes, so the margin is unknown.`
      : '',
    summary.failedLegs
      ? `${plural(summary.failedLegs, 'travel leg')} could not be refreshed; the saved minutes are used.`
      : '',
    ...summary.manualBelowGoogle.map((leg) => (
      `${leg.from} → ${leg.to} was typed as ${leg.minutes} min; Google gives ${leg.googleMinutes} at that time.`
    )),
  ].filter(Boolean)
  const warn = summary.late.length > 0 || summary.unknown.length > 0 || summary.failedLegs > 0
    || summary.manualBelowGoogle.length > 0
  return (
    <Alert severity={warn ? 'warning' : 'success'} variant="outlined" sx={{ mb: 2 }}>
      {heading} {notes.join(' ')}
    </Alert>
  )
}
