import { useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import multiMonthPlugin from '@fullcalendar/multimonth'
import timeGridPlugin from '@fullcalendar/timegrid'
import {
  Box,
  Button,
  ButtonGroup,
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
import { useColorScheme, useTheme } from '@mui/material/styles'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import { getActivityTone } from '../../calendar/data/calendarEvents.js'
import CalendarEventCard from '../../calendar/components/CalendarEventCard.jsx'
import { useProductionActivities } from '../../calendar/context/useProductionActivities.js'
import {
  createHeldServiceCalendarEvents,
  createServiceCalendarEventsFromRequests,
  filterServiceCalendarEvents,
  getServiceCalendarEventDisplayMode,
  getServiceCalendarViewDescription,
  getServiceEventTone,
  getServiceWorkTypeFilterOptions,
  serviceAppointmentStatusOptions,
  serviceCalendarViewOptions,
} from '../data/serviceCalendarEvents.js'
import CustomerServiceCalendarDetail from './CustomerServiceCalendarDetail.jsx'
import VisitChangeActions from './VisitChangeActions.jsx'
import CustomerServiceEventCard from './CustomerServiceEventCard.jsx'
import { customerServiceTimeZone, getCustomerServiceClock } from '../utils/dates.js'
import { scheduledDelayMargins } from '../utils/proposalDraft.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import '../../calendar/components/CalendarScheduler.css'
import './CustomerServiceCalendar.css'

const initialCalendarTitle = new Intl.DateTimeFormat('en-US', {
  timeZone: customerServiceTimeZone,
  month: 'long',
  year: 'numeric',
}).format(new Date())

const serviceCalendarViews = {
  dayGridMonth: {
    dayHeaderFormat: { weekday: 'short' },
    dayMaxEvents: 3,
  },
  timeGridWeek: {
    dayHeaderFormat: { weekday: 'short', month: 'short', day: 'numeric' },
  },
  timeGridDay: {
    dayHeaderFormat: { weekday: 'long', month: 'long', day: 'numeric' },
  },
  listWeek: {
    listDayFormat: { weekday: 'long', month: 'short', day: 'numeric' },
    listDaySideFormat: false,
  },
  multiMonthYear: {
    dayHeaderFormat: { weekday: 'narrow' },
    dayMaxEvents: 2,
    multiMonthMaxColumns: 3,
    multiMonthMinWidth: 270,
  },
}

// What each color means (25 Nov 2026). An in-progress visit keeps the confirmed color.
const legendItems = [
  { tone: 'confirmed', label: 'Confirmed · In progress' },
  { tone: 'awaiting', label: 'Awaiting customer' },
  { tone: 'completed', label: 'Completed' },
  { tone: 'overdue', label: 'Overdue' },
]

// onNotice(notice): what to tell the coordinator after a visit moved or was cancelled.
export default function CustomerServiceCalendar({ requests, settings, onViewRequest, onNotice }) {
  const calendarRef = useRef(null)
  const { technicians, storedTravelMinutes, holidays } = useCustomerServicePrototype()
  // Each visit carries its delay margin from the saved travel legs, which the day-before
  // traffic check refreshes (block R6). One computation per day shown. Days held by a
  // proposal waiting for the customer are added as tentative (Awaiting customer).
  const serviceEvents = useMemo(() => {
    const marginsByDate = new Map()
    const visits = createServiceCalendarEventsFromRequests(requests).map((event) => {
      const date = String(event.start).slice(0, 10)
      if (!marginsByDate.has(date)) {
        marginsByDate.set(date, scheduledDelayMargins({ requests, technicians, date, travelMinutes: storedTravelMinutes }))
      }
      const delayMargin = marginsByDate.get(date)[String(event.extendedProps.requestId)]
      return delayMargin === undefined ? event : { ...event, extendedProps: { ...event.extendedProps, delayMargin } }
    })
    return [...visits, ...createHeldServiceCalendarEvents(requests, technicians)]
  }, [requests, technicians, storedTravelMinutes])
  const { events: productionOverlayEvents } = useProductionActivities()
  const theme = useTheme()
  const { mode, systemMode } = useColorScheme()
  const resolvedColorMode = mode === 'system' ? systemMode : mode
  const colorMode = resolvedColorMode === 'dark' ? 'dark' : 'light'
  const [viewTitle, setViewTitle] = useState(initialCalendarTitle)
  const [viewType, setViewType] = useState('dayGridMonth')
  const [technicianFilter, setTechnicianFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [workTypeFilter, setWorkTypeFilter] = useState('all')
  const [showProduction, setShowProduction] = useState(false)
  // Visits are Monday to Friday, so weekends are hidden unless asked for (25 Nov 2026).
  const [showWeekends, setShowWeekends] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const technicianOptions = useMemo(() => {
    const technicians = new Map()
    for (const event of serviceEvents) {
      const { technicianId, technician } = event.extendedProps
      for (const person of event.extendedProps.assignedTechnicians ?? [{ id: technicianId, name: technician }]) {
        if (person.id && person.name) technicians.set(String(person.id), person.name)
      }
    }
    return [...technicians].map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [serviceEvents])
  const workTypeOptions = useMemo(
    () => getServiceWorkTypeFilterOptions(serviceEvents),
    [serviceEvents],
  )
  const filteredServiceEvents = useMemo(() => filterServiceCalendarEvents(serviceEvents, {
    technician: technicianFilter,
    status: statusFilter,
    workType: workTypeFilter,
  }), [serviceEvents, statusFilter, technicianFilter, workTypeFilter])

  // Days Valtrim is closed: a shaded background with the holiday name, whatever the filters.
  // The list has no background, so there a holiday is its own row.
  const holidayEvents = useMemo(() => holidays.map((holiday) => ({
    id: `holiday-${holiday.date}`,
    start: holiday.date,
    allDay: true,
    display: viewType === 'listWeek' ? 'auto' : 'background',
    title: holiday.name,
    extendedProps: { calendarType: 'HOLIDAY' },
  })), [holidays, viewType])

  const visibleEvents = useMemo(() => [
    ...holidayEvents,
    ...filteredServiceEvents,
    ...(showProduction ? productionOverlayEvents : []),
  ], [filteredServiceEvents, holidayEvents, productionOverlayEvents, showProduction])

  const selectedEvent = visibleEvents.find((event) => event.id === selectedId) ?? null

  const navigateCalendar = (direction) => {
    const api = calendarRef.current?.getApi()
    if (!api) return
    if (direction === 'prev') api.prev()
    if (direction === 'next') api.next()
    if (direction === 'today') api.gotoDate(getCustomerServiceClock().date)
  }

  const changeView = (nextView) => {
    calendarRef.current?.getApi().changeView(nextView)
    setViewType(nextView)
  }

  const openDayView = (date) => {
    calendarRef.current?.getApi().changeView('timeGridDay', date)
    setViewType('timeGridDay')
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

        <FormControl size="small" sx={{ minWidth: 190 }}>
          <InputLabel id="service-calendar-work-type-label">Work type</InputLabel>
          <Select
            labelId="service-calendar-work-type-label"
            label="Work type"
            value={workTypeFilter}
            onChange={(event) => setWorkTypeFilter(event.target.value)}
          >
            <MenuItem value="all">All work types</MenuItem>
            {workTypeOptions.map((workType) => (
              <MenuItem key={workType.value} value={workType.value}>
                {workType.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControlLabel
          className="service-calendar-weekends-toggle"
          control={(
            <Switch
              checked={showWeekends}
              onChange={(event) => setShowWeekends(event.target.checked)}
            />
          )}
          label="Show weekends"
        />

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
              {serviceCalendarViewOptions.map((view) => (
                <Button
                  key={view.value}
                  className={viewType === view.value ? 'is-active' : ''}
                  onClick={() => changeView(view.value)}
                >
                  {view.label}
                </Button>
              ))}
            </ButtonGroup>
          </Box>

          <Box className="calendar-all-day-note service-calendar-note">
            <EventAvailableRoundedIcon fontSize="small" />
            <span>
              {getServiceCalendarViewDescription(viewType)}
              {filteredServiceEvents.length === 0 && ' · No approved service visits match the current filters'}
            </span>
            <Box component="ul" className="service-calendar-legend" aria-label="Calendar colors">
              {legendItems.map((item) => (
                <li key={item.tone}>
                  <span
                    className={`service-legend__swatch service-tone--${item.tone}`}
                    style={item.tone === 'awaiting' ? { '--service-accent': theme.palette.secondary.main } : undefined}
                    aria-hidden="true"
                  />
                  {item.label}
                </li>
              ))}
              <li>
                <span className="service-legend__swatch service-legend__swatch--holiday" aria-hidden="true" />
                Holiday
              </li>
            </Box>
          </Box>

          <Box className={`calendar-canvas service-calendar-canvas service-calendar-canvas--${viewType}`}>
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, interactionPlugin, listPlugin, multiMonthPlugin, timeGridPlugin]}
              initialView="dayGridMonth"
              initialDate={getCustomerServiceClock().date}
              now={() => {
                const clock = getCustomerServiceClock()
                const hour = String(Math.floor(clock.minutesSinceMidnight / 60)).padStart(2, '0')
                const minute = String(clock.minutesSinceMidnight % 60).padStart(2, '0')
                return `${clock.date}T${hour}:${minute}:00`
              }}
              firstDay={1}
              weekends={showWeekends}
              headerToolbar={false}
              views={serviceCalendarViews}
              allDaySlot={showProduction}
              allDayText="Production"
              slotMinTime={settings.workdayStartsAt}
              slotMaxTime={settings.workdayEndsAt}
              slotDuration="01:00:00"
              slotLabelInterval="01:00:00"
              scrollTime={settings.workdayStartsAt}
              nowIndicator
              displayEventTime={false}
              navLinks
              navLinkDayClick={openDayView}
              noEventsContent="No service visits match these filters"
              height={['timeGridWeek', 'timeGridDay'].includes(viewType)
                ? 'var(--service-calendar-timegrid-height)'
                : 'auto'}
              expandRows
              fixedWeekCount={false}
              editable={false}
              selectable={false}
              events={visibleEvents}
              eventClick={({ event }) => {
                if (event.extendedProps.calendarType !== 'HOLIDAY') setSelectedId(event.id)
              }}
              eventContent={(info) => {
                if (info.event.extendedProps.calendarType === 'HOLIDAY') {
                  return info.view.type === 'listWeek'
                    ? <span className="service-holiday__list">{info.event.title} · Closed, no visits</span>
                    : <span className="service-holiday__label">{info.event.title} · Closed</span>
                }
                const displayMode = getServiceCalendarEventDisplayMode(info.view.type)
                return info.event.extendedProps.calendarType === 'CUSTOMER_SERVICE'
                  ? <CustomerServiceEventCard event={info.event} displayMode={displayMode} />
                  : <CalendarEventCard event={info.event} displayMode={displayMode} />
              }}
              eventClassNames={({ event }) => {
                if (event.extendedProps.calendarType === 'HOLIDAY') return ['service-holiday']
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
          visitActions={selectedEvent?.extendedProps.requestId != null && (
            <VisitChangeActions requestId={selectedEvent.extendedProps.requestId} onChanged={(notice) => {
              setSelectedId(null)
              onNotice?.(notice)
            }} />
          )}
          onViewRequest={onViewRequest ? (event) => {
            const request = requests.find((entry) => entry.id === event.extendedProps.requestId)
            if (request) {
              setSelectedId(null)
              onViewRequest(request)
            }
          } : undefined}
        />
      </Drawer>
    </Box>
  )
}

