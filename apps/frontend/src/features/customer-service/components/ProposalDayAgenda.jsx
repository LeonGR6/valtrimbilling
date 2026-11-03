import { Alert, Box, Stack, Typography } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { formatLongDate, formatTime } from '../utils/dates.js'
import { prototypePlanningHours } from '../utils/proposalDraft.js'
import '../../calendar/components/CalendarScheduler.css'
import './CustomerServiceCalendar.css'

export default function ProposalDayAgenda({ date, agenda, hasTechnicians }) {
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
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" fontWeight={800}>Technician agenda · {formatLongDate(date)} · California time</Typography>
      <Typography variant="caption" color="text.secondary">
        Confirmed visits and sent proposals reserve the full two-hour customer window, plus any internal work extending beyond it.
        Moving the internal start does not free part of that window.
        Drafts do not reserve time or appear in Calendar.
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
              return (
                <Box sx={{ px: 0.75, py: 0.25, overflow: 'hidden', fontSize: '0.72rem', color: '#fff' }}
                  title={`${event.title} · ${entry.issue} · ${entry.stage === 'AWAITING_CUSTOMER' ? 'Reserved pending customer response' : entry.stage}`}>
                  <Typography component="div" variant="caption" fontWeight={800}>{event.title}</Typography>
                  <div>{formatTime(entry.start)}–{formatTime(entry.end)} · {entry.blocksAvailability ? 'Reserved time' : 'Visit time'}</div>
                  <div>{entry.stage === 'AWAITING_CUSTOMER' ? 'Awaiting customer · Reserved' : entry.stage === 'COMPLETED' ? 'Completed' : 'Confirmed'}</div>
                  <div>Customer: {entry.windowUncertain ? 'Window missing or invalid' : `${formatTime(entry.customerWindow.start)}–${formatTime(entry.customerWindow.end)}`}</div>
                  <div>Internal: {entry.timingUncertain ? 'Timing missing' : `${formatTime(entry.internalSlot.start)}–${formatTime(entry.internalSlot.end)}`}</div>
                </Box>
              )
            }}
          />
        </Box>
      </Box>
    </Stack>
  )
}
