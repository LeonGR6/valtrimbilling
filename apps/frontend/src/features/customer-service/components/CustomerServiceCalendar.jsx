import { useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import timeGridPlugin from '@fullcalendar/timegrid'
import {
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import {
  getActivityTone,
  initialCalendarEvents,
} from '../../calendar/data/calendarEvents.js'
import CalendarEventCard from '../../calendar/components/CalendarEventCard.jsx'
import { technicianOptions } from '../data/customerService.js'
import {
  getServiceEventTone,
  serviceAppointmentStatusOptions,
  serviceWorkTypeOptions,
} from '../data/serviceCalendarEvents.js'
import { useCustomerServiceCalendar } from '../context/useCustomerServiceCalendar.js'
import CustomerServiceCalendarDetail from './CustomerServiceCalendarDetail.jsx'
import CustomerServiceEventCard from './CustomerServiceEventCard.jsx'
import '../../calendar/components/CalendarScheduler.css'
import './CustomerServiceCalendar.css'

const initialCalendarTitle = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}).format(new Date())

function startOfCurrentWeek() {
  const date = new Date()
  const day = date.getDay()
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day))
  date.setHours(12, 0, 0, 0)
  return date
}

function toDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createProductionOverlayEvents() {
  const monday = startOfCurrentWeek()
  const typeOffsets = { EXT: 0, SHUTTER: 1, DM: 2, HW: 3 }

  return initialCalendarEvents.map((event, index) => {
    const date = new Date(monday)
    const groupOffset = index >= 4 ? 1 : 0
    date.setDate(date.getDate() + (typeOffsets[event.extendedProps.activityType] ?? 0) + groupOffset)
    return {
      ...event,
      id: `customer-service-overlay-${event.id}`,
      start: toDateString(date),
    }
  })
}

export default function CustomerServiceCalendar({ onNotice }) {
  const calendarRef = useRef(null)
  const { serviceEvents } = useCustomerServiceCalendar()
  const { mode, systemMode } = useColorScheme()
  const resolvedColorMode = mode === 'system' ? systemMode : mode
  const colorMode = resolvedColorMode === 'dark' ? 'dark' : 'light'
  const [viewTitle, setViewTitle] = useState(initialCalendarTitle)
  const [viewType, setViewType] = useState('timeGridWeek')
  const [technicianFilter, setTechnicianFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [visibleWorkTypes, setVisibleWorkTypes] = useState(['HW', 'WS'])
  const [showProduction, setShowProduction] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const productionOverlayEvents = useMemo(() => createProductionOverlayEvents(), [])

  const filteredServiceEvents = useMemo(() => serviceEvents.filter((event) => {
    const props = event.extendedProps
    const technicianMatches = technicianFilter === 'all'
      || String(props.technicianId) === technicianFilter
    const statusMatches = statusFilter === 'all' || props.status === statusFilter
    const workTypeMatches = props.workTypes.every((type) => visibleWorkTypes.includes(type))
    return technicianMatches && statusMatches && workTypeMatches
  }), [serviceEvents, statusFilter, technicianFilter, visibleWorkTypes])

  const visibleEvents = useMemo(() => (
    showProduction
      ? [...filteredServiceEvents, ...productionOverlayEvents]
      : filteredServiceEvents
  ), [filteredServiceEvents, productionOverlayEvents, showProduction])

  const selectedEvent = visibleEvents.find((event) => event.id === selectedId) ?? null

  const navigateCalendar = (direction) => {
    const api = calendarRef.current?.getApi()
    if (!api) return
    if (direction === 'prev') api.prev()
    if (direction === 'next') api.next()
    if (direction === 'today') api.today()
  }

  const changeView = (nextView) => {
    calendarRef.current?.getApi().changeView(nextView)
    setViewType(nextView)
  }

  const toggleWorkType = (workType) => {
    setVisibleWorkTypes((current) => current.includes(workType)
      ? current.filter((value) => value !== workType)
      : [...current, workType])
  }

  return (
    <Box className={`calendar-page calendar-theme--${colorMode} customer-service-calendar`}>
      <Box className="service-calendar-filterbar">
        <FormControl size="small" sx={{ minWidth: 190 }}>
          <InputLabel id="service-calendar-technician-label">Technician</InputLabel>
          <Select
            labelId="service-calendar-technician-label"
            label="Technician"
            value={technicianFilter}
            onChange={(event) => setTechnicianFilter(event.target.value)}
          >
            <MenuItem value="all">All technicians</MenuItem>
            {technicianOptions.map((technician) => (
              <MenuItem key={technician.value} value={String(technician.value)}>
                {technician.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel id="service-calendar-status-label">Status</InputLabel>
          <Select
            labelId="service-calendar-status-label"
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <MenuItem value="all">All statuses</MenuItem>
            {serviceAppointmentStatusOptions.map((status) => (
              <MenuItem key={status.value} value={status.value}>{status.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box className="service-calendar-work-types" aria-label="Filter work types">
          {serviceWorkTypeOptions.map((workType) => (
            <FormControlLabel
              key={workType.value}
              control={(
                <Checkbox
                  size="small"
                  checked={visibleWorkTypes.includes(workType.value)}
                  onChange={() => toggleWorkType(workType.value)}
                />
              )}
              label={workType.label}
            />
          ))}
        </Box>

        <FormControlLabel
          className="service-calendar-production-toggle"
          control={(
            <Switch
              checked={showProduction}
              onChange={(event) => setShowProduction(event.target.checked)}
            />
          )}
          label="Show production events"
        />
      </Box>

      <Box className="calendar-workspace service-calendar-workspace">
        <Box className="calendar-main">
          <Box className="calendar-period">
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Button size="small" color="inherit" variant="outlined" onClick={() => navigateCalendar('today')}>Today</Button>
              <ButtonGroup size="small" variant="outlined" aria-label="Navigate service calendar">
                <Tooltip title="Previous period">
                  <IconButton size="small" onClick={() => navigateCalendar('prev')} aria-label="Previous period">
                    <ArrowBackIosNewRoundedIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Next period">
                  <IconButton size="small" onClick={() => navigateCalendar('next')} aria-label="Next period">
                    <ArrowForwardIosRoundedIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              </ButtonGroup>
            </Stack>

            <Typography variant="h6" fontWeight={750} className="calendar-period__title">
              {viewTitle}
            </Typography>

            <ButtonGroup className="calendar-view-switcher" size="small" variant="outlined" aria-label="Change service calendar view">
              <Button className={viewType === 'dayGridMonth' ? 'is-active' : ''} onClick={() => changeView('dayGridMonth')}>Month</Button>
              <Button className={viewType === 'timeGridWeek' ? 'is-active' : ''} onClick={() => changeView('timeGridWeek')}>Week</Button>
              <Button className={viewType === 'listWeek' ? 'is-active' : ''} onClick={() => changeView('listWeek')}>List</Button>
            </ButtonGroup>
          </Box>

          <Box className="calendar-all-day-note service-calendar-note">
            <EventAvailableRoundedIcon fontSize="small" />
            <span>Service visits · Open an event to review the request and its last completed visit</span>
          </Box>

          <Box className="calendar-canvas service-calendar-canvas">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, interactionPlugin, listPlugin, timeGridPlugin]}
              initialView="timeGridWeek"
              initialDate={new Date()}
              firstDay={1}
              weekends
              headerToolbar={false}
              allDaySlot
              allDayText="Production"
              slotMinTime="08:00:00"
              slotMaxTime="18:00:00"
              slotDuration="01:00:00"
              slotLabelInterval="01:00:00"
              displayEventTime={false}
              dayHeaderFormat={{ weekday: 'short', month: 'short', day: 'numeric' }}
              listDayFormat={{ weekday: 'long', month: 'short', day: 'numeric' }}
              listDaySideFormat={{ year: 'numeric' }}
              noEventsContent="No service visits match these filters"
              height="100%"
              expandRows
              fixedWeekCount={false}
              dayMaxEvents={false}
              editable={false}
              selectable={false}
              events={visibleEvents}
              eventClick={({ event }) => setSelectedId(event.id)}
              eventContent={(info) => (
                info.event.extendedProps.calendarType === 'CUSTOMER_SERVICE'
                  ? <CustomerServiceEventCard event={info.event} isList={info.view.type === 'listWeek'} />
                  : <CalendarEventCard event={info.event} isList={info.view.type === 'listWeek'} />
              )}
              eventClassNames={({ event }) => {
                if (event.extendedProps.calendarType === 'CUSTOMER_SERVICE') {
                  const tone = getServiceEventTone(event.extendedProps.status)
                  return [`fc-service--${tone}`, `service-tone--${tone}`, event.id === selectedId ? 'is-selected' : '']
                }
                const tone = getActivityTone(event.extendedProps.activityType, event.extendedProps.orderMaterial)
                return [`fc-activity--${tone}`, `activity-tone--${tone}`, event.id === selectedId ? 'is-selected' : '']
              }}
              datesSet={({ view }) => {
                setViewTitle(view.title)
                setViewType(view.type)
              }}
            />
          </Box>
        </Box>
      </Box>

      <Drawer
        anchor="right"
        open={Boolean(selectedEvent)}
        onClose={() => setSelectedId(null)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 430 }, maxWidth: '100%' } } }}
      >
        <CustomerServiceCalendarDetail
          event={selectedEvent}
          onClose={() => setSelectedId(null)}
          onEdit={() => onNotice?.('Visit editing is visual-only in this frontend prototype.')}
        />
      </Drawer>
    </Box>
  )
}

