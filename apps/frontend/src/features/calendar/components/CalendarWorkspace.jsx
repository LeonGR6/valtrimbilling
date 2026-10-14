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
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  activityTypeOptions,
  getActivityTone,
} from '../data/calendarEvents.js'
import CalendarEventCard from './CalendarEventCard.jsx'
import CalendarSearchResults from './CalendarSearchResults.jsx'

function hasScope(scope) {
  return scope.builder !== 'ALL' || scope.community !== 'ALL' || scope.jobId !== 'ALL'
}

export default function CalendarWorkspace({
  calendarRef,
  events,
  totalEventCount,
  scope,
  onChangeScope,
  onClearScope,
  selectedId,
  viewTitle,
  viewType,
  visibleTypes,
  onChangeView,
  onDatesSet,
  onEventClick,
  onEventMove,
  canMove = false,
  onNavigate,
  onToggleType,
  search,
  searchResults,
  onChangeSearch,
}) {
  const searching = search.trim() !== ''
  // The calendar stays mounted while searching so it comes back on the same
  // period; it is only hidden.
  const hiddenWhileSearching = searching ? { display: 'none' } : undefined

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

        <Box className="calendar-scope-filters" aria-label="Search and filter events">
          <TextField
            size="small"
            type="search"
            className="calendar-filter-search"
            placeholder="Search events…"
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onChangeSearch('')
            }}
            slotProps={{
              htmlInput: { 'aria-label': 'Search events' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: search
                  ? (
                      <InputAdornment position="end">
                        <IconButton size="small" aria-label="Clear search" onClick={() => onChangeSearch('')}>
                          <ClearRoundedIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    )
                  : null,
              },
            }}
          />
          <TextField
            select
            size="small"
            className="calendar-filter-select"
            value={scope.builder}
            slotProps={{ htmlInput: { 'aria-label': 'Builder' } }}
            onChange={(event) => onChangeScope('builder', event.target.value)}
          >
            <MenuItem value="ALL">All builders</MenuItem>
            {scope.options.builders.map((name) => (
              <MenuItem key={name} value={name}>{name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            className="calendar-filter-select"
            value={scope.community}
            slotProps={{ htmlInput: { 'aria-label': 'Community' } }}
            onChange={(event) => onChangeScope('community', event.target.value)}
          >
            <MenuItem value="ALL">All communities</MenuItem>
            {scope.options.communities.map((name) => (
              <MenuItem key={name} value={name}>{name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            className="calendar-filter-select"
            value={scope.jobId}
            slotProps={{ htmlInput: { 'aria-label': 'Job' } }}
            onChange={(event) => onChangeScope('jobId', event.target.value)}
          >
            <MenuItem value="ALL">All jobs</MenuItem>
            {scope.options.jobs.map(({ id, label }) => (
              <MenuItem key={id} value={id}>{label}</MenuItem>
            ))}
          </TextField>
          {hasScope(scope) && (
            <Button size="small" color="inherit" onClick={onClearScope}>Clear filters</Button>
          )}
          {!searching && (
            <Typography variant="caption" color="text.secondary">
              Showing {events.length} of {totalEventCount} events
            </Typography>
          )}
        </Box>
      </Box>

      <Box className="calendar-workspace">
        <Box className="calendar-main">
          {searching && (
            <CalendarSearchResults
              results={searchResults}
              query={search}
              selectedId={selectedId}
              onOpen={onEventClick}
            />
          )}

          <Box className="calendar-period" style={hiddenWhileSearching}>
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

            <Stack direction="row" spacing={0.5} className="calendar-period__title-group">
              <Typography variant="h6" fontWeight={750} className="calendar-period__title">{viewTitle}</Typography>
              <Tooltip
                title={viewType === 'listWeek'
                  ? 'Weekly list · Open any row to view or edit its full Production group'
                  : viewType === 'multiMonthYear'
                    ? 'Annual calendar · Review all 12 months in one view'
                    : 'All-day activities · Open any event to view or edit its full Production group. Drag an event to another day to change its date.'}
              >
                <InfoOutlinedIcon fontSize="small" className="calendar-period__info" aria-label="About this view" />
              </Tooltip>
            </Stack>

            <ButtonGroup className="calendar-view-switcher" size="small" variant="outlined" aria-label="Change calendar view">
              <Button className={viewType === 'dayGridMonth' ? 'is-active' : ''} onClick={() => onChangeView('dayGridMonth')}>Month</Button>
              <Button className={viewType === 'dayGridWeek' ? 'is-active' : ''} onClick={() => onChangeView('dayGridWeek')}>Week</Button>
              <Button className={viewType === 'listWeek' ? 'is-active' : ''} onClick={() => onChangeView('listWeek')}>List</Button>
              <Button className={viewType === 'multiMonthYear' ? 'is-active' : ''} onClick={() => onChangeView('multiMonthYear')}>Year</Button>
            </ButtonGroup>
          </Box>

          <Box className="calendar-canvas" style={hiddenWhileSearching}>
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, interactionPlugin, listPlugin, multiMonthPlugin]}
              initialView={viewType}
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
                  // Three events per day; the rest open in a small popover.
                  dayMaxEvents: 3,
                  moreLinkClick: 'popover',
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
              moreLinkContent={({ num }) => `${num} more`}
              editable={false}
              droppable={false}
              selectable={false}
              eventStartEditable={canMove}
              // A few pixels of wobble while clicking must not count as a drag.
              eventDragMinDistance={8}
              eventDurationEditable={false}
              events={events}
              eventClick={({ event }) => onEventClick(event.id)}
              // A drag never changes the date by itself: the event goes back to
              // its day and the configuration opens to confirm the new one.
              eventDrop={(info) => {
                info.revert()
                onEventMove?.(info.event.id, info.event.startStr.slice(0, 10))
              }}
              eventContent={(info) => <CalendarEventCard
                event={info.event}
                isList={info.view.type === 'listWeek'}
                isMonth={info.view.type === 'dayGridMonth'}
              />}
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
