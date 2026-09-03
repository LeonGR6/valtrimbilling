import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import multiMonthPlugin from '@fullcalendar/multimonth'
import {
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  FormControlLabel,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import {
  activityTypeOptions,
  getActivityTone,
} from '../data/calendarEvents.js'
import CalendarEventCard from './CalendarEventCard.jsx'

export default function CalendarWorkspace({
  calendarRef,
  events,
  selectedId,
  viewTitle,
  viewType,
  visibleTypes,
  onChangeView,
  onDatesSet,
  onEventClick,
  onNavigate,
  onToggleType,
}) {
  return (
    <>
      <Box className="calendar-toolbar">
        <Box className="calendar-type-filters" aria-label="Filter activity types">
          {activityTypeOptions.map((type) => (
            <FormControlLabel
              key={type.value}
              className={`calendar-type-filter activity-tone--${type.tone}`}
              control={(
                <Checkbox
                  checked={visibleTypes.includes(type.value)}
                  onChange={() => onToggleType(type.value)}
                  size="small"
                />
              )}
              label={type.label}
            />
          ))}
          <Box className="calendar-color-key activity-tone--ext-order">
            <span />
            EXT · Order Material
          </Box>
        </Box>
      </Box>

      <Box className="calendar-workspace">
        <Box className="calendar-main">
          <Box className="calendar-period">
            <Stack className="calendar-period__navigation" direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Button size="small" color="inherit" variant="outlined" onClick={() => onNavigate('today')}>Today</Button>
              <ButtonGroup size="small" variant="outlined" aria-label="Navigate calendar">
                <Tooltip title="Previous period">
                  <IconButton size="small" onClick={() => onNavigate('prev')} aria-label="Previous period">
                    <ArrowBackIosNewRoundedIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Next period">
                  <IconButton size="small" onClick={() => onNavigate('next')} aria-label="Next period">
                    <ArrowForwardIosRoundedIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              </ButtonGroup>
            </Stack>

            <Typography variant="h6" fontWeight={750} className="calendar-period__title">{viewTitle}</Typography>

            <ButtonGroup className="calendar-view-switcher" size="small" variant="outlined" aria-label="Change calendar view">
              <Button className={viewType === 'dayGridMonth' ? 'is-active' : ''} onClick={() => onChangeView('dayGridMonth')}>Month</Button>
              <Button className={viewType === 'dayGridWeek' ? 'is-active' : ''} onClick={() => onChangeView('dayGridWeek')}>Week</Button>
              <Button className={viewType === 'listWeek' ? 'is-active' : ''} onClick={() => onChangeView('listWeek')}>List</Button>
              <Button className={viewType === 'multiMonthYear' ? 'is-active' : ''} onClick={() => onChangeView('multiMonthYear')}>Year</Button>
            </ButtonGroup>
          </Box>

          <Box className="calendar-all-day-note">
            <EventAvailableRoundedIcon fontSize="small" />
            <span>
              {viewType === 'listWeek'
                ? 'Weekly list · Open any row to view or edit its full Production group'
                : viewType === 'multiMonthYear'
                  ? 'Annual calendar · Review all 12 months in one view'
                  : 'All-day activities · Open any event to view or edit its full Production group'}
            </span>
          </Box>

          <Box className="calendar-canvas">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, interactionPlugin, listPlugin, multiMonthPlugin]}
              initialView="dayGridWeek"
              initialDate={new Date()}
              firstDay={1}
              weekends
              headerToolbar={false}
              displayEventTime={false}
              views={{
                dayGridWeek: {
                  dayHeaderFormat: { weekday: 'short', day: 'numeric' },
                },
                dayGridMonth: {
                  dayHeaderFormat: { weekday: 'short' },
                },
                multiMonthYear: {
                  dayHeaderFormat: { weekday: 'short' },
                  multiMonthMaxColumns: 3,
                  multiMonthMinWidth: 260,
                },
              }}
              listDayFormat={{ weekday: 'long', month: 'short', day: 'numeric' }}
              listDaySideFormat={{ year: 'numeric' }}
              noEventsContent="No production activities in this period"
              height="100%"
              expandRows
              fixedWeekCount={false}
              dayMaxEvents={false}
              editable={false}
              droppable={false}
              selectable={false}
              eventStartEditable={false}
              eventDurationEditable={false}
              events={events}
              eventClick={({ event }) => onEventClick(event.id)}
              eventContent={(info) => <CalendarEventCard event={info.event} isList={info.view.type === 'listWeek'} />}
              eventClassNames={({ event }) => {
                const tone = getActivityTone(event.extendedProps.activityType, event.extendedProps.orderMaterial)
                return [`fc-activity--${tone}`, `activity-tone--${tone}`, event.id === selectedId ? 'is-selected' : '']
              }}
              datesSet={({ view }) => onDatesSet(view.title, view.type)}
            />
          </Box>
        </Box>
      </Box>
    </>
  )
}
