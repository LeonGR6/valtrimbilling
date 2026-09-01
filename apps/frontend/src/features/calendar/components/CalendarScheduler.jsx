import { useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Chip,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  Select,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import {
  activityTypeMap,
  activityTypeOptions,
  emptyCalendarDraft,
  initialCalendarEvents,
} from '../data/calendarEvents.js'
import { calendarEventSchema } from '../schemas/calendarEventSchema.js'
import './CalendarScheduler.css'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const builderOptions = ['KB Home', 'Lennar', 'Trumark']
const communityOptions = ['Andara', 'Solara', 'Haven']
const phaseOptions = ['Phase 1', 'Phase 2', 'Phase 3']
const buildingOptions = ['Building 1', 'Building 2', 'Building 3', 'Building 4']

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDate(dateString) {
  return dateString ? dateFormatter.format(parseLocalDate(dateString)) : '—'
}

function getLotsLabel(lotStart, lotEnd) {
  return Number(lotStart) === Number(lotEnd)
    ? `Lot ${lotStart}`
    : `Lots ${lotStart}–${lotEnd}`
}

function createDefaultSplitParts(draft) {
  const lotStart = Math.max(1, Number(draft.lotStart) || 1)
  const requestedEnd = Number(draft.lotEnd) || lotStart + 1
  const lotEnd = Math.max(lotStart + 1, requestedEnd)
  const midpoint = Math.floor((lotStart + lotEnd) / 2)
  const stamp = Date.now()

  return [
    { id: `split-${stamp}-a`, lotStart, lotEnd: midpoint, date: draft.date },
    { id: `split-${stamp}-b`, lotStart: midpoint + 1, lotEnd, date: draft.date },
  ]
}

function createCalendarEvents(values, groupId) {
  const type = activityTypeMap[values.activityType]
  const splitParts = values.splitPhase
    ? [...values.splitParts].sort((a, b) => a.lotStart - b.lotStart)
    : []
  const schedules = values.splitPhase
    ? splitParts
    : [{ lotStart: values.lotStart, lotEnd: values.lotEnd, date: values.date }]
  const commonProps = {
    groupId,
    activityType: values.activityType,
    builder: values.builder,
    community: values.community,
    phase: values.phase,
    building: values.building,
    notes: values.notes,
    splitPhase: values.splitPhase,
    splitParts,
    installOnly: values.installOnly,
    installDate: values.installDate,
    lockUp: false,
  }
  const stamp = Date.now()

  const calendarEvents = schedules.map((schedule, index) => ({
    id: `${groupId}-phase-${stamp}-${index}`,
    groupId,
    title: `${type.label} • ${getLotsLabel(schedule.lotStart, schedule.lotEnd)}`,
    start: schedule.date,
    allDay: true,
    extendedProps: {
      ...commonProps,
      lotStart: schedule.lotStart,
      lotEnd: schedule.lotEnd,
      variant: 'base',
    },
  }))

  if (values.installOnly) {
    calendarEvents.push({
      id: `${groupId}-install-${stamp}`,
      groupId,
      title: `${type.label} INSTALL ONLY • ${getLotsLabel(values.lotStart, values.lotEnd)}`,
      start: values.installDate,
      allDay: true,
      extendedProps: {
        ...commonProps,
        lotStart: values.lotStart,
        lotEnd: values.lotEnd,
        variant: 'install-only',
      },
    })
  }

  return calendarEvents
}

function EventCard({ event }) {
  const props = event.extendedProps
  const type = activityTypeMap[props.activityType]

  return (
    <Box className={`work-event activity-tone--${type.tone}`}>
      <Box className="work-event__topline">
        <strong>{type.label}</strong>
        {props.variant === 'install-only' && <span className="work-event__tag">Install only</span>}
      </Box>
      <span className="work-event__community">{props.community}</span>
      <span className="work-event__lots">{getLotsLabel(props.lotStart, props.lotEnd)}</span>
    </Box>
  )
}

function DetailRow({ icon, label, children }) {
  return (
    <Box className="activity-detail__row">
      <Box className="activity-detail__row-icon">{icon}</Box>
      <Box>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="body2" fontWeight={650}>{children}</Typography>
      </Box>
    </Box>
  )
}

function DrawerHeader({ eyebrow, title, onClose }) {
  return (
    <Box className="activity-drawer__header">
      <Box>
        <Typography variant="overline" color="text.secondary" fontWeight={750}>{eyebrow}</Typography>
        <Typography variant="h5" fontWeight={780} letterSpacing="-0.02em">{title}</Typography>
      </Box>
      <IconButton onClick={onClose} aria-label="Close drawer" size="small">
        <CloseRoundedIcon />
      </IconButton>
    </Box>
  )
}

function ScheduleRow({ label, lotStart, lotEnd, date, tone }) {
  return (
    <Box className={`schedule-row activity-tone--${tone}`}>
      <Box className="schedule-row__date">
        <CalendarMonthRoundedIcon fontSize="small" />
        <span>{formatDate(date)}</span>
      </Box>
      <Typography variant="body2" fontWeight={750}>{label}</Typography>
      <Typography variant="caption" color="text.secondary">{getLotsLabel(lotStart, lotEnd)} · All day</Typography>
    </Box>
  )
}

function ActivityDetail({ event, groupEvents, onClose, onEdit }) {
  if (!event) return null

  const props = event.extendedProps
  const type = activityTypeMap[props.activityType]
  const baseEvent = groupEvents.find((item) => item.extendedProps.variant !== 'install-only') ?? event
  const schedules = props.splitPhase
    ? props.splitParts
    : [{
        id: baseEvent.id,
        lotStart: baseEvent.extendedProps.lotStart,
        lotEnd: baseEvent.extendedProps.lotEnd,
        date: baseEvent.start,
      }]

  return (
    <Box className="activity-drawer__layout">
      <DrawerHeader eyebrow="ACTIVITY DETAILS" title="Scheduled activity" onClose={onClose} />

      <Box className="activity-drawer__scroll">
        <Box className={`activity-detail__hero activity-tone--${type.tone}`}>
          <Box className="activity-detail__type-mark">{props.activityType}</Box>
          <Box>
            <Typography variant="h6" fontWeight={780}>{type.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {getLotsLabel(props.lotStart, props.lotEnd)}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={props.variant === 'install-only' ? 'Install only' : 'All day'}
            className="activity-detail__chip"
          />
        </Box>

        <Box className="activity-detail__grid">
          <DetailRow icon={<BusinessRoundedIcon />} label="Builder">{props.builder}</DetailRow>
          <DetailRow icon={<LocationOnOutlinedIcon />} label="Community">{props.community}</DetailRow>
          <DetailRow icon={<LayersOutlinedIcon />} label="Phase">{props.phase}</DetailRow>
          <DetailRow icon={<ApartmentRoundedIcon />} label="Building">{props.building}</DetailRow>
        </Box>

        <Divider />

        <Box className="activity-detail__section">
          <Box className="activity-detail__section-title">
            <Typography variant="subtitle1" fontWeight={750}>
              {props.splitPhase ? 'Split phase schedule' : 'Schedule'}
            </Typography>
            {props.splitPhase && <Chip size="small" label={`${schedules.length} divisions`} />}
          </Box>
          <Stack spacing={1}>
            {schedules.map((schedule, index) => (
              <ScheduleRow
                key={schedule.id ?? `${schedule.date}-${index}`}
                label={props.splitPhase ? `Division ${index + 1}` : type.label}
                lotStart={schedule.lotStart}
                lotEnd={schedule.lotEnd}
                date={schedule.date}
                tone={type.tone}
              />
            ))}
            {props.installOnly && (
              <ScheduleRow
                label="Install only"
                lotStart={props.splitPhase ? props.splitParts[0].lotStart : props.lotStart}
                lotEnd={props.splitPhase ? props.splitParts.at(-1).lotEnd : props.lotEnd}
                date={props.installDate}
                tone={type.tone}
              />
            )}
          </Stack>
        </Box>

        {props.notes && (
          <Paper variant="outlined" className="activity-detail__notes">
            <Typography variant="caption" color="text.secondary" fontWeight={750}>NOTES / SCOPE OF WORK</Typography>
            <Typography variant="body2">{props.notes}</Typography>
          </Paper>
        )}
      </Box>

      <Box className="activity-drawer__footer">
        <Button variant="outlined" color="inherit" onClick={onClose}>Close</Button>
        <Button variant="contained" startIcon={<EditOutlinedIcon />} onClick={onEdit} disableElevation>
          Edit activity
        </Button>
      </Box>
    </Box>
  )
}

function ActivityTypePicker({ value, onChange }) {
  return (
    <Box className="activity-type-picker" role="radiogroup" aria-label="Activity type">
      {activityTypeOptions.map((type) => (
        <Box
          component="label"
          key={type.value}
          className={`activity-type-option activity-tone--${type.tone} ${value === type.value ? 'is-selected' : ''}`}
        >
          <Radio
            checked={value === type.value}
            onChange={() => onChange(type.value)}
            value={type.value}
            size="small"
            inputProps={{ 'aria-label': type.label }}
          />
          <Box>
            <Typography variant="subtitle2" fontWeight={800}>{type.label}</Typography>
            <Typography variant="caption" color="text.secondary">{type.description}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function SelectField({ label, value, options, onChange }) {
  return (
    <TextField select label={label} value={value} onChange={(event) => onChange(event.target.value)} fullWidth required>
      {options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
    </TextField>
  )
}

function ActivityForm({ draft, isEditing, formError, onChange, onClose, onSave }) {
  const type = activityTypeMap[draft.activityType]
  const supportsInstallOnly = draft.activityType === 'EXT' || draft.activityType === 'DM'
  const supportsSplitPhase = draft.activityType === 'DM' || draft.activityType === 'HW'
  const totalLots = Math.max(0, Number(draft.lotEnd) - Number(draft.lotStart) + 1)
  const canAddDivision = draft.splitParts.length < totalLots

  const changeActivityType = (activityType) => {
    onChange({
      activityType,
      installOnly: activityType === 'HW' ? false : draft.installOnly,
      installDate: activityType === 'HW' ? '' : draft.installDate,
      splitPhase: activityType === 'EXT' ? false : draft.splitPhase,
      splitParts: activityType === 'EXT' ? [] : draft.splitParts,
      lockUp: false,
    })
  }

  const toggleSplitPhase = (checked) => {
    onChange({
      splitPhase: checked,
      splitParts: checked ? createDefaultSplitParts(draft) : [],
    })
  }

  const updateSplitPart = (id, field, value) => {
    onChange({
      splitParts: draft.splitParts.map((part) => part.id === id ? { ...part, [field]: value } : part),
    })
  }

  const addDivision = () => {
    let widestIndex = -1
    let widestSize = 0
    draft.splitParts.forEach((part, index) => {
      const size = Number(part.lotEnd) - Number(part.lotStart) + 1
      if (size > widestSize) {
        widestIndex = index
        widestSize = size
      }
    })

    if (widestIndex < 0 || widestSize < 2) return

    const part = draft.splitParts[widestIndex]
    const midpoint = Math.floor((Number(part.lotStart) + Number(part.lotEnd)) / 2)
    const nextParts = [...draft.splitParts]
    nextParts.splice(
      widestIndex,
      1,
      { ...part, lotEnd: midpoint },
      { ...part, id: `split-${Date.now()}`, lotStart: midpoint + 1 },
    )
    onChange({ splitParts: nextParts })
  }

  const removeDivision = (index) => {
    if (draft.splitParts.length <= 2) return
    const nextParts = draft.splitParts.map((part) => ({ ...part }))
    const [removed] = nextParts.splice(index, 1)

    if (index > 0) nextParts[index - 1].lotEnd = removed.lotEnd
    else nextParts[0].lotStart = removed.lotStart

    onChange({ splitParts: nextParts })
  }

  return (
    <Box component="form" className="activity-drawer__layout" onSubmit={onSave}>
      <DrawerHeader
        eyebrow={isEditing ? 'EDIT ACTIVITY' : 'NEW ACTIVITY'}
        title={isEditing ? 'Edit activity' : 'Add activity'}
        onClose={onClose}
      />

      <Box className="activity-drawer__scroll">
        {formError && <Alert severity="error">{formError}</Alert>}

        <Box className="activity-form__section">
          <Box className="activity-form__heading">
            <Typography variant="subtitle2" fontWeight={800}>Activity type</Typography>
            <Typography variant="caption" color="text.secondary">Color is assigned automatically.</Typography>
          </Box>
          <ActivityTypePicker value={draft.activityType} onChange={changeActivityType} />
        </Box>

        <Box className="activity-form__section">
          <Typography variant="subtitle2" fontWeight={800}>Project location</Typography>
          <Box className="activity-form__grid">
            <SelectField label="Builder" value={draft.builder} options={builderOptions} onChange={(value) => onChange({ builder: value })} />
            <SelectField label="Community" value={draft.community} options={communityOptions} onChange={(value) => onChange({ community: value })} />
            <SelectField label="Phase" value={draft.phase} options={phaseOptions} onChange={(value) => onChange({ phase: value })} />
            <SelectField label="Building" value={draft.building} options={buildingOptions} onChange={(value) => onChange({ building: value })} />
          </Box>
        </Box>

        <Box className="activity-form__section">
          <Box className="activity-form__heading">
            <Typography variant="subtitle2" fontWeight={800}>Lot range</Typography>
            <Typography variant="caption" color="text.secondary">Enter the first and last lot.</Typography>
          </Box>
          <Box className="lot-range-fields">
            <TextField
              label="From lot"
              type="number"
              value={draft.lotStart}
              onChange={(event) => onChange({ lotStart: event.target.value })}
              slotProps={{ htmlInput: { min: 1 } }}
              required
            />
            <span>—</span>
            <TextField
              label="To lot"
              type="number"
              value={draft.lotEnd}
              onChange={(event) => onChange({ lotEnd: event.target.value })}
              slotProps={{ htmlInput: { min: 1 } }}
              required
            />
          </Box>
        </Box>

        <Box className="activity-form__section">
          <Typography variant="subtitle2" fontWeight={800}>Options for {type.label}</Typography>
          <Paper variant="outlined" className="activity-options-card">
            {supportsInstallOnly && (
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={draft.installOnly}
                    onChange={(event) => onChange({
                      installOnly: event.target.checked,
                      installDate: event.target.checked ? (draft.installDate || draft.date) : '',
                    })}
                  />
                )}
                label={(
                  <Box>
                    <Typography variant="body2" fontWeight={700}>Install only</Typography>
                    <Typography variant="caption" color="text.secondary">Add it as a separate calendar event.</Typography>
                  </Box>
                )}
              />
            )}
            {supportsSplitPhase && (
              <FormControlLabel
                control={<Checkbox checked={draft.splitPhase} onChange={(event) => toggleSplitPhase(event.target.checked)} />}
                label={(
                  <Box>
                    <Typography variant="body2" fontWeight={700}>Split phase</Typography>
                    <Typography variant="caption" color="text.secondary">Schedule groups of lots on different dates.</Typography>
                  </Box>
                )}
              />
            )}
            {draft.activityType === 'HW' && (
              <FormControlLabel
                disabled
                control={<Checkbox checked={false} />}
                label={(
                  <Box className="lockup-label">
                    <Box>
                      <Typography variant="body2" fontWeight={700}>Lock up</Typography>
                      <Typography variant="caption" color="text.secondary">Hardware lock-up workflow.</Typography>
                    </Box>
                    <Chip size="small" label="Coming later" />
                  </Box>
                )}
              />
            )}
          </Paper>
        </Box>

        {draft.splitPhase ? (
          <Box className="activity-form__section">
            <Box className="activity-form__heading activity-form__heading--actions">
              <Box>
                <Typography variant="subtitle2" fontWeight={800}>Split schedule</Typography>
                <Typography variant="caption" color="text.secondary">Every division is an all-day event.</Typography>
              </Box>
              <Stack direction="row" spacing={0.5}>
                <Button size="small" onClick={() => onChange({ splitParts: createDefaultSplitParts(draft) })}>Reset</Button>
                <Button size="small" startIcon={<AddRoundedIcon />} onClick={addDivision} disabled={!canAddDivision}>Division</Button>
              </Stack>
            </Box>

            <Stack spacing={1.25}>
              {draft.splitParts.map((part, index) => (
                <Paper key={part.id} variant="outlined" className={`split-part activity-tone--${type.tone}`}>
                  <Box className="split-part__heading">
                    <Typography variant="caption" fontWeight={800}>DIVISION {index + 1}</Typography>
                    <IconButton
                      size="small"
                      aria-label={`Remove division ${index + 1}`}
                      disabled={draft.splitParts.length <= 2}
                      onClick={() => removeDivision(index)}
                    >
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <Box className="split-part__fields">
                    <TextField
                      label="From"
                      type="number"
                      value={part.lotStart}
                      onChange={(event) => updateSplitPart(part.id, 'lotStart', event.target.value)}
                      slotProps={{ htmlInput: { min: 1 } }}
                      required
                    />
                    <TextField
                      label="To"
                      type="number"
                      value={part.lotEnd}
                      onChange={(event) => updateSplitPart(part.id, 'lotEnd', event.target.value)}
                      slotProps={{ htmlInput: { min: 1 } }}
                      required
                    />
                    <TextField
                      label="Date"
                      type="date"
                      value={part.date}
                      onChange={(event) => updateSplitPart(part.id, 'date', event.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                      required
                    />
                  </Box>
                </Paper>
              ))}
            </Stack>
          </Box>
        ) : (
          <Box className="activity-form__section">
            <Typography variant="subtitle2" fontWeight={800}>Activity date</Typography>
            <TextField
              label="Date"
              type="date"
              value={draft.date}
              onChange={(event) => onChange({ date: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
              required
            />
          </Box>
        )}

        {draft.installOnly && (
          <Box className="activity-form__section">
            <Typography variant="subtitle2" fontWeight={800}>Install-only date</Typography>
            <TextField
              label="Install-only date"
              type="date"
              value={draft.installDate}
              onChange={(event) => onChange({ installDate: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
              required
            />
          </Box>
        )}

        <Box className="activity-form__section">
          <TextField
            label="Notes / Scope of work"
            value={draft.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
            multiline
            rows={3}
            fullWidth
          />
        </Box>

        <Alert severity="info" icon={<EventAvailableRoundedIcon />}>
          Activities are all-day events. To reschedule one, edit its date in this drawer.
        </Alert>
      </Box>

      <Box className="activity-drawer__footer">
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation>
          {isEditing ? 'Save changes' : 'Create activity'}
        </Button>
      </Box>
    </Box>
  )
}

export default function CalendarScheduler() {
  const calendarRef = useRef(null)
  const [events, setEvents] = useState(initialCalendarEvents)
  const [selectedId, setSelectedId] = useState(null)
  const [drawerMode, setDrawerMode] = useState(null)
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [draft, setDraft] = useState(emptyCalendarDraft)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [viewTitle, setViewTitle] = useState('Aug 10 – 14, 2026')
  const [viewType, setViewType] = useState('dayGridWeek')
  const [filters, setFilters] = useState({ builder: 'All', community: 'All', phase: 'All', building: 'All' })
  const [visibleTypes, setVisibleTypes] = useState(['EXT', 'DM', 'HW'])

  const filterOptions = useMemo(() => ({
    builder: [...new Set(events.map((event) => event.extendedProps.builder))],
    community: [...new Set(events.map((event) => event.extendedProps.community))],
    phase: [...new Set(events.map((event) => event.extendedProps.phase))],
    building: [...new Set(events.map((event) => event.extendedProps.building))],
  }), [events])

  const filteredEvents = useMemo(() => events.filter((event) => (
    visibleTypes.includes(event.extendedProps.activityType)
    && Object.entries(filters).every(([key, value]) => value === 'All' || event.extendedProps[key] === value)
  )), [events, filters, visibleTypes])

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null
  const selectedGroupEvents = selectedEvent
    ? events.filter((event) => (
        (event.extendedProps.groupId ?? event.groupId ?? event.id)
        === (selectedEvent.extendedProps.groupId ?? selectedEvent.groupId ?? selectedEvent.id)
      ))
    : []

  const closeDrawer = () => {
    setDrawerMode(null)
    setSelectedId(null)
    setEditingGroupId(null)
    setFormError('')
  }

  const openCreateDrawer = () => {
    setSelectedId(null)
    setEditingGroupId(null)
    setDraft({ ...emptyCalendarDraft })
    setFormError('')
    setDrawerMode('create')
  }

  const openDetailDrawer = (eventId) => {
    setSelectedId(eventId)
    setEditingGroupId(null)
    setFormError('')
    setDrawerMode('detail')
  }

  const openEditDrawer = () => {
    if (!selectedEvent) return

    const props = selectedEvent.extendedProps
    const groupId = props.groupId ?? selectedEvent.groupId ?? selectedEvent.id
    const groupEvents = events.filter((event) => (
      (event.extendedProps.groupId ?? event.groupId ?? event.id) === groupId
    ))
    const baseEvent = groupEvents.find((event) => event.extendedProps.variant !== 'install-only') ?? selectedEvent
    const baseProps = baseEvent.extendedProps
    const splitParts = baseProps.splitPhase ? baseProps.splitParts.map((part) => ({ ...part })) : []
    const lotStart = baseProps.splitPhase
      ? Math.min(...splitParts.map((part) => Number(part.lotStart)))
      : baseProps.lotStart
    const lotEnd = baseProps.splitPhase
      ? Math.max(...splitParts.map((part) => Number(part.lotEnd)))
      : baseProps.lotEnd

    setDraft({
      ...emptyCalendarDraft,
      ...baseProps,
      lotStart,
      lotEnd,
      date: baseEvent.start,
      splitParts,
      lockUp: false,
    })
    setEditingGroupId(groupId)
    setFormError('')
    setDrawerMode('edit')
  }

  const saveActivity = (event) => {
    event.preventDefault()
    const result = calendarEventSchema.safeParse(draft)

    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? 'Review the activity details.')
      return
    }

    const values = result.data
    const groupId = editingGroupId ?? `activity-${Date.now()}`
    const nextEvents = createCalendarEvents(values, groupId)

    setEvents((current) => {
      const withoutEditedGroup = editingGroupId
        ? current.filter((item) => (item.extendedProps.groupId ?? item.groupId ?? item.id) !== editingGroupId)
        : current
      return [...withoutEditedGroup, ...nextEvents]
    })
    setSelectedId(nextEvents[0].id)
    setEditingGroupId(null)
    setDrawerMode('detail')
    setFormError('')
    setNotice(editingGroupId ? 'Activity updated.' : 'Activity added to the calendar.')
  }

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

  const toggleType = (activityType) => {
    setVisibleTypes((current) => current.includes(activityType)
      ? current.filter((type) => type !== activityType)
      : [...current, activityType])
  }

  return (
    <Box className="calendar-page">
      <Box className="calendar-page__header">
        <Box>
          <Typography variant="h4" fontWeight={780} letterSpacing="-0.025em">Calendar</Typography>
          <Typography color="text.secondary">Plan every phase by date and lot range.</Typography>
        </Box>
        <ResponsiveCreateButton label="New activity" onClick={openCreateDrawer} />
      </Box>

      <Box className="calendar-toolbar">
        <Box className="calendar-type-filters" aria-label="Filter activity types">
          {activityTypeOptions.map((type) => (
            <FormControlLabel
              key={type.value}
              className={`calendar-type-filter activity-tone--${type.tone}`}
              control={(
                <Checkbox
                  checked={visibleTypes.includes(type.value)}
                  onChange={() => toggleType(type.value)}
                  size="small"
                />
              )}
              label={type.label}
            />
          ))}
        </Box>

        <Box className="calendar-toolbar__spacer" />

        {[
          ['builder', 'Builder', <BusinessRoundedIcon key="builder" fontSize="small" />],
          ['community', 'Community', <LocationOnOutlinedIcon key="community" fontSize="small" />],
          ['phase', 'Phase', <LayersOutlinedIcon key="phase" fontSize="small" />],
          ['building', 'Building', <ApartmentRoundedIcon key="building" fontSize="small" />],
        ].map(([key, label, icon]) => (
          <FormControl key={key} size="small" className="calendar-filter">
            <InputLabel id={`${key}-filter-label`}>{label}</InputLabel>
            <Select
              labelId={`${key}-filter-label`}
              label={label}
              value={filters[key]}
              onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
              startAdornment={<Box className="calendar-filter__icon">{icon}</Box>}
            >
              <MenuItem value="All">All</MenuItem>
              {filterOptions[key].map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
            </Select>
          </FormControl>
        ))}
      </Box>

      <Box className="calendar-workspace">
        <Box className="calendar-main">
          <Box className="calendar-period">
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Button size="small" color="inherit" variant="outlined" onClick={() => navigateCalendar('today')}>Today</Button>
              <ButtonGroup size="small" variant="outlined" aria-label="Navigate calendar">
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
              <Typography variant="h6" fontWeight={750} className="calendar-period__title">{viewTitle}</Typography>
            </Stack>

            <ButtonGroup size="small" variant="outlined" aria-label="Change calendar view">
              <Button className={viewType === 'dayGridWeek' ? 'is-active' : ''} onClick={() => changeView('dayGridWeek')}>Week</Button>
              <Button className={viewType === 'dayGridMonth' ? 'is-active' : ''} onClick={() => changeView('dayGridMonth')}>Month</Button>
            </ButtonGroup>
          </Box>

          <Box className="calendar-all-day-note">
            <EventAvailableRoundedIcon fontSize="small" />
            <span>All-day activities · Open an activity to view or change its date</span>
          </Box>

          <Box className="calendar-canvas">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, interactionPlugin]}
              initialView="dayGridWeek"
              initialDate="2026-08-10"
              firstDay={1}
              weekends={false}
              headerToolbar={false}
              displayEventTime={false}
              dayHeaderFormat={{ weekday: 'short', day: 'numeric' }}
              height="100%"
              expandRows
              fixedWeekCount={false}
              dayMaxEvents={false}
              editable={false}
              droppable={false}
              selectable={false}
              eventStartEditable={false}
              eventDurationEditable={false}
              events={filteredEvents}
              eventClick={({ event }) => openDetailDrawer(event.id)}
              eventContent={(info) => <EventCard event={info.event} />}
              eventClassNames={({ event }) => {
                const tone = activityTypeMap[event.extendedProps.activityType]?.tone ?? 'ext'
                return [`fc-activity--${tone}`, event.id === selectedId ? 'is-selected' : '']
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
        open={Boolean(drawerMode)}
        onClose={closeDrawer}
        slotProps={{
          paper: {
            className: 'activity-drawer',
            sx: { width: { xs: '100%', sm: 480 }, maxWidth: '100%' },
          },
        }}
      >
        {drawerMode === 'detail' ? (
          <ActivityDetail
            event={selectedEvent}
            groupEvents={selectedGroupEvents}
            onClose={closeDrawer}
            onEdit={openEditDrawer}
          />
        ) : (
          <ActivityForm
            draft={draft}
            isEditing={drawerMode === 'edit'}
            formError={formError}
            onChange={(patch) => {
              setDraft((current) => ({ ...current, ...patch }))
              setFormError('')
            }}
            onClose={closeDrawer}
            onSave={saveActivity}
          />
        )}
      </Drawer>

      <Snackbar open={Boolean(notice)} autoHideDuration={3200} onClose={() => setNotice('')} message={notice} />
    </Box>
  )
}
