import { useMemo } from 'react'
import { Alert } from '@mui/material'
import { customerServiceMinimumMarginMinutes } from '../utils/customerServiceScheduling.js'
import { formatWeekdayDate } from '../utils/dates.js'
import { formatDepartureTime } from '../utils/travelEstimates.js'
import { travelCheckSummary, upcomingTravelCheck } from '../utils/travelCheck.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

// On-screen note of the day-before traffic check (block R6, decision D6: no email).
export default function TravelCheckAlert({ requests }) {
  const { travelChecks, technicians, storedTravelMinutes } = useCustomerServicePrototype()
  const check = upcomingTravelCheck(travelChecks)
  const summary = useMemo(
    () => (check ? travelCheckSummary({ check, requests, technicians, travelMinutes: storedTravelMinutes }) : null),
    [check, requests, technicians, storedTravelMinutes],
  )
  if (!summary || summary.visits === 0) return null

  const heading = `Traffic checked at ${formatDepartureTime(summary.checkedAt)} for ${formatWeekdayDate(summary.targetDate)}.`
  const notes = [
    summary.tight.length
      ? `${summary.tight.map((visit) => `${visit.requestNumber} can start only ${Math.max(0, visit.margin)} min late`).join('; ')}.`
        + ` Review ${summary.tight.length === 1 ? 'it' : 'them'}: the target is at least ${customerServiceMinimumMarginMinutes} min.`
      : `All ${plural(summary.visits, 'visit')} can start at least ${customerServiceMinimumMarginMinutes} min late.`,
    summary.unknown.length
      ? `${summary.unknown.map((visit) => visit.requestNumber).join(', ')}: a travel leg has no minutes, so the margin is unknown.`
      : '',
    summary.failedLegs
      ? `${plural(summary.failedLegs, 'travel leg')} could not be refreshed; the saved minutes are used.`
      : '',
  ].filter(Boolean)
  const warn = summary.tight.length > 0 || summary.unknown.length > 0 || summary.failedLegs > 0
  return (
    <Alert severity={warn ? 'warning' : 'success'} variant="outlined" sx={{ mb: 2 }}>
      {heading} {notes.join(' ')}
    </Alert>
  )
}
