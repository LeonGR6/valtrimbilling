import { Alert, Box, Stack, Typography } from '@mui/material'
import { useColorScheme, useTheme } from '@mui/material/styles'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { formatLongDate, formatTime } from '../utils/dates.js'
import { prototypePlanningHours } from '../utils/proposalDraft.js'
import '../../calendar/components/CalendarScheduler.css'
import './CustomerServiceCalendar.css'

// " · Margin N min" when the visit's delay margin is known for this draft.
const marginText = (margin) => (Number.isInteger(margin) ? ` · Margin ${Math.max(0, margin)} min` : '')

export default function ProposalDayAgenda({ date, agenda, hasTechnicians, proposedVisit = null, margins = {} }) {
  const theme = useTheme()
  const { mode, systemMode } = useColorScheme()
  const colorMode = (mode === 'system' ? systemMode : mode) === 'dark' ? 'dark' : 'light'
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
      title: `${proposedVisit.label} · Proposed`,
      start: `${date}T${proposedVisit.start}:00`, end: `${date}T${proposedVisit.end}:00`,
      backgroundColor: theme.palette.secondary.main, borderColor: 'transparent',
      extendedProps: { proposed: true, ...proposedVisit },
    })
  }
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" fontWeight={800}>Technician agenda · {formatLongDate(date)} · California time</Typography>
      <Typography variant="caption" color="text.secondary">
        Confirmed, in-progress and sent visits reserve their work time plus 10 minutes of pickup, not the whole customer window.
        A visit without recorded work time keeps its whole window reserved.
        Drafts do not reserve time or appear in Calendar.
        With a valid draft, each visit shows its margin: how late it can start without it or a later visit leaving its
        customer window.
      </Typography>
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
            eventContent={({ event }) => {
              const entry = event.extendedProps
              if (entry.proposed) {
                return (
                  <Box sx={{ px: 0.75, py: 0.25, overflow: 'hidden', fontSize: '0.72rem', color: 'secondary.contrastText' }}
                    title={`${event.title} · Not reserved until the proposal is sent`}>
                    <Typography component="div" variant="caption" fontWeight={800}>{event.title}</Typography>
                    <div>Work: {formatTime(entry.start)}–{formatTime(entry.workEnd)} · Pickup until {formatTime(entry.end)}</div>
                    <div>Preview · not reserved{marginText(entry.margin)}</div>
                  </Box>
                )
              }
              return (
                <Box sx={{ px: 0.75, py: 0.25, overflow: 'hidden', fontSize: '0.72rem', color: '#fff' }}
                  title={`${event.title} · ${entry.issue} · ${entry.stage === 'AWAITING_CUSTOMER' ? 'Reserved pending customer response' : entry.stage}`}>
                  <Typography component="div" variant="caption" fontWeight={800}>{event.title}</Typography>
                  <div>
                    {formatTime(entry.start)}–{formatTime(entry.end)} · {entry.blocksAvailability ? 'Reserved time' : 'Visit time'}
                    {marginText(margins[`${entry.requestId}-${entry.technicianId}`])}
                  </div>
                  <div>{entry.stage === 'AWAITING_CUSTOMER' ? 'Awaiting customer · Reserved' : entry.stage === 'COMPLETED' ? 'Completed' : entry.stage === 'WORKING' ? 'In progress' : 'Confirmed'}</div>
                  <div>Customer: {entry.windowUncertain ? 'Window missing or invalid' : `${formatTime(entry.customerWindow.start)}–${formatTime(entry.customerWindow.end)}`}</div>
                  <div>Work: {entry.timingUncertain ? 'Timing missing · whole window reserved' : `${formatTime(entry.internalSlot.start)}–${formatTime(entry.internalSlot.end)} · Pickup until ${formatTime(entry.end)}`}</div>
                </Box>
              )
            }}
          />
        </Box>
      </Box>
    </Stack>
  )
}
