import { useMemo, useState } from 'react'
import { Alert, Box, Dialog, Stack, Typography } from '@mui/material'
import { useColorScheme, useTheme } from '@mui/material/styles'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { proposedServiceCalendarEvent, serviceCalendarEventForRequest } from '../data/serviceCalendarEvents.js'
import { formatLongDate, formatTime } from '../utils/dates.js'
import { prototypePlanningHours } from '../utils/proposalDraft.js'
import CustomerServiceCalendarDetail from './CustomerServiceCalendarDetail.jsx'
import '../../calendar/components/CalendarScheduler.css'
import './CustomerServiceCalendar.css'

// " · Margin N min" when the visit's delay margin is known for this draft.
const marginText = (margin) => (Number.isInteger(margin) ? ` · Margin ${Math.max(0, margin)} min` : '')

// proposedVisit: the slot being planned, or the recommended slot shown before one is chosen
// (recommended: true). { label, date, windowStart, start, workEnd, end, margin, technicianNames }
export default function ProposalDayAgenda({
  date, agenda, hasTechnicians, proposedVisit = null, margins = {}, requests = [], plannedRequest = null,
}) {
  const theme = useTheme()
  const { mode, systemMode } = useColorScheme()
  const colorMode = (mode === 'system' ? systemMode : mode) === 'dark' ? 'dark' : 'light'
  // A visit picked in the agenda opens its request, read-only, as in Calendar: a recorded
  // visit by its request id, the planned one ('proposed') with the slot shown and a day
  // held by a sent proposal (its agenda entry) with that option.
  const [selected, setSelected] = useState(null)
  const recordedEvent = useMemo(
    () => (typeof selected === 'string' && selected !== 'proposed' ? serviceCalendarEventForRequest(requests, selected) : null),
    [requests, selected],
  )
  const heldEvent = () => proposedServiceCalendarEvent(
    requests.find((request) => String(request.id) === String(selected.requestId)),
    {
      date: selected.date, windowStart: selected.customerWindow.start,
      start: selected.internalSlot.start, end: selected.internalSlot.end,
      technicianNames: agenda.filter((entry) => entry.requestId === selected.requestId
        && entry.proposalOption === selected.proposalOption).map((entry) => entry.technicianName),
    },
    'AWAITING_CUSTOMER',
  )
  const selectedEvent = selected === 'proposed' && proposedVisit
    ? proposedServiceCalendarEvent(plannedRequest, {
      date: proposedVisit.date, windowStart: proposedVisit.windowStart, start: proposedVisit.start,
      end: proposedVisit.workEnd, technicianNames: proposedVisit.technicianNames,
    })
    : selected?.proposalOption ? heldEvent() : recordedEvent
  const proposedLabel = proposedVisit?.recommended ? 'Recommended' : 'Proposed'
  if (!hasTechnicians) return <Alert severity="info" variant="outlined">Select technicians to view their recorded daily agenda.</Alert>
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return <Alert severity="info" variant="outlined">Select a date to view the agenda.</Alert>
  const events = agenda.filter((entry) => entry.date && entry.start && entry.end).map((entry) => ({
    id: `${entry.requestId}-${entry.technicianId}`,
    title: `${entry.requestNumber} · ${entry.technicianName}`,
    start: `${entry.date}T${entry.start}:00`, end: `${entry.date}T${entry.end}:00`,
    backgroundColor: entry.stage === 'AWAITING_CUSTOMER' ? '#9a6700' : entry.stage === 'COMPLETED' ? '#64748b' : '#1d4ed8',
    borderColor: 'transparent', extendedProps: entry,
  }))
  // Preview of the visit being planned. It is not reserved until the proposal is sent.
  if (proposedVisit) {
    events.push({
      id: 'proposed-visit',
      title: `${proposedVisit.label} · ${proposedLabel}`,
      start: `${date}T${proposedVisit.start}:00`, end: `${date}T${proposedVisit.end}:00`,
      backgroundColor: theme.palette.secondary.main, borderColor: 'transparent',
      extendedProps: { proposed: true, ...proposedVisit },
    })
  }
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" fontWeight={800}>Technician agenda · {formatLongDate(date)} · California time</Typography>
      <Typography variant="caption" color="text.secondary">
        Each visit reserves its work time plus 10 minutes of pickup; one without a recorded work time reserves its whole
        window. Days offered in a sent proposal stay reserved until the customer answers. Drafts reserve nothing. Margin
        is how late a visit can start and still finish inside its window. Select a visit to view its request.
      </Typography>
      {proposedVisit?.recommended && (
        <Alert severity="info" variant="outlined">
          Showing the recommended slot for {proposedVisit.technicianNames.join(', ')}. Use it above to fill the form.
        </Alert>
      )}
      {agenda.length === 0 && <Alert severity="info" variant="outlined">No Customer Service appointments or sent proposals are recorded for these technicians on this date.</Alert>}
      {agenda.filter((entry) => !entry.date || entry.windowUncertain || !entry.start || !entry.end).map((entry) => (
        <Alert key={`${entry.requestId}-${entry.technicianId}`} severity="warning" variant="outlined">{entry.requestNumber} · {entry.technicianName}: the recorded date or two-hour window is incomplete.</Alert>
      ))}
      <Box className={`calendar-page calendar-theme--${colorMode} customer-service-calendar`} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Box className="service-calendar-canvas" sx={{ minHeight: '0 !important', p: 1 }}>
          <FullCalendar
            key={date}
            plugins={[timeGridPlugin]}
            initialView="timeGridDay"
            initialDate={date}
            headerToolbar={false}
            dayHeaders={false}
            allDaySlot={false}
            slotMinTime={prototypePlanningHours.workdayStartsAt}
            slotMaxTime={prototypePlanningHours.workdayEndsAt}
            slotDuration="00:30:00"
            height={460}
            events={events}
            editable={false}
            selectable={false}
            eventMinHeight={54}
            eventClick={({ event }) => {
              const entry = event.extendedProps
              setSelected(entry.proposed ? 'proposed' : entry.proposalOption ? entry : String(entry.requestId))
            }}
            eventContent={({ event }) => {
              const entry = event.extendedProps
              if (entry.proposed) {
                return (
                  <Box sx={{ px: 0.75, py: 0.25, overflow: 'hidden', fontSize: '0.72rem', color: 'secondary.contrastText', cursor: 'pointer' }}
                    title={`${event.title} · Not reserved until the proposal is sent`}>
                    <Typography component="div" variant="caption" fontWeight={800}>{event.title}</Typography>
                    <div>Work: {formatTime(entry.start)}–{formatTime(entry.workEnd)} · Pickup until {formatTime(entry.end)}</div>
                    <div>Preview · not reserved{marginText(entry.margin)}</div>
                  </Box>
                )
              }
              return (
                <Box sx={{ px: 0.75, py: 0.25, overflow: 'hidden', fontSize: '0.72rem', color: '#fff', cursor: 'pointer' }}
                  title={`${event.title} · ${entry.issue} · ${entry.stage === 'AWAITING_CUSTOMER' ? 'Reserved pending customer response' : entry.stage}`}>
                  <Typography component="div" variant="caption" fontWeight={800}>{event.title}</Typography>
                  <div>
                    {formatTime(entry.start)}–{formatTime(entry.end)} · {entry.blocksAvailability ? 'Reserved time' : 'Visit time'}
                    {marginText(margins[`${entry.requestId}-${entry.technicianId}`])}
                  </div>
                  <div>
                    {entry.proposalOption ? `Awaiting customer · Option ${entry.proposalOption} held`
                      : entry.stage === 'AWAITING_CUSTOMER' ? 'Awaiting customer · Reserved'
                        : entry.stage === 'COMPLETED' ? 'Completed' : entry.stage === 'WORKING' ? 'In progress' : 'Confirmed'}
                  </div>
                  <div>Customer: {entry.windowUncertain ? 'Window missing or invalid' : `${formatTime(entry.customerWindow.start)}–${formatTime(entry.customerWindow.end)}`}</div>
                  <div>Work: {entry.timingUncertain ? 'Timing missing · whole window reserved' : `${formatTime(entry.internalSlot.start)}–${formatTime(entry.internalSlot.end)} · Pickup until ${formatTime(entry.end)}`}</div>
                </Box>
              )
            }}
          />
        </Box>
      </Box>
      <Dialog open={Boolean(selectedEvent)} onClose={() => setSelected(null)} fullWidth maxWidth="xs"
        slotProps={{ paper: { 'aria-label': `Request ${selectedEvent?.extendedProps.requestNumber ?? ''}` } }}>
        <CustomerServiceCalendarDetail event={selectedEvent} onClose={() => setSelected(null)} canCancel={false} />
      </Dialog>
    </Stack>
  )
}
