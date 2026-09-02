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
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EngineeringRoundedIcon from '@mui/icons-material/EngineeringRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { initialContacts } from '../../builder-contacts/data/builderContacts.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { initialPeople } from '../../people/data/people.js'
import {
  activityTypeMap,
  activityTypeOptions,
  changeOrderType,
  createDraftFromProductionEvent,
  createEmptyProductionDraft,
  createProductionCalendarEvents,
  getActivityTone,
  getLotsLabel,
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

const supervisorsById = new Map(initialPeople.map((person) => [person.id, person]))
const superintendentsById = new Map(initialContacts.map((person) => [person.id, person]))

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDate(dateString) {
  return dateString ? dateFormatter.format(parseLocalDate(dateString)) : '—'
}

function formatPhase(value) {
  return String(value).toLowerCase().startsWith('phase') ? String(value) : `Phase ${value}`
}

function formatBuilding(value) {
  return String(value).toLowerCase().startsWith('building') ? String(value) : `Building ${value}`
}

function sortLotNumbers(lots) {
  return [...lots].sort((a, b) => Number(a.lotNumber) - Number(b.lotNumber))
}

function getPhasePatch(job, phase) {
  const lots = sortLotNumbers(phase?.lots ?? [])
  const lotNumbers = lots.map((lot) => String(lot.lotNumber))

  return {
    jobId: job?.id ?? '',
    phaseId: phase?.id ?? '',
    jobCode: job?.code ?? '',
    builder: job?.builder ?? '',
    community: job?.community ?? '',
    phase: phase ? formatPhase(phase.name) : '',
    building: phase ? formatBuilding(phase.building) : '',
    lotStart: Number(lotNumbers[0]) || 1,
    lotEnd: Number(lotNumbers.at(-1)) || 1,
    lotNumbers,
    foreman: supervisorsById.get(job?.supervisorId)?.name ?? '',
    superintendent: superintendentsById.get(job?.superintendentId)?.name ?? '',
    dmSplitPhase: false,
    dmSplitParts: [],
    hwSplitPhase: false,
    hwSplitParts: [],
  }
}

function createDefaultSplitParts(draft, date) {
  const lotStart = Math.max(1, Number(draft.lotStart) || 1)
  const requestedEnd = Number(draft.lotEnd) || lotStart + 1
  const lotEnd = Math.max(lotStart + 1, requestedEnd)
  const midpoint = Math.floor((lotStart + lotEnd) / 2)
  const stamp = Date.now()

  return [
    { id: `split-${stamp}-a`, lotStart, lotEnd: midpoint, date },
    { id: `split-${stamp}-b`, lotStart: midpoint + 1, lotEnd, date },
  ]
}

function addSplitDivision(parts) {
  let widestIndex = -1
  let widestSize = 0

  parts.forEach((part, index) => {
    const size = Number(part.lotEnd) - Number(part.lotStart) + 1
    if (size > widestSize) {
      widestIndex = index
      widestSize = size
    }
  })

  if (widestIndex < 0 || widestSize < 2) return parts

  const part = parts[widestIndex]
  const midpoint = Math.floor((Number(part.lotStart) + Number(part.lotEnd)) / 2)
  const nextParts = [...parts]
  nextParts.splice(
    widestIndex,
    1,
    { ...part, lotEnd: midpoint },
    { ...part, id: `split-${Date.now()}`, lotStart: midpoint + 1 },
  )
  return nextParts
}

function removeSplitDivision(parts, index) {
  if (parts.length <= 2) return parts

  const nextParts = parts.map((part) => ({ ...part }))
  const [removed] = nextParts.splice(index, 1)
  if (index > 0) nextParts[index - 1].lotEnd = removed.lotEnd
  else nextParts[0].lotStart = removed.lotStart
  return nextParts
}

function EventCard({ event }) {
  const props = event.extendedProps
  const type = activityTypeMap[props.activityType]
  const tone = getActivityTone(props.activityType, props.orderMaterial)

  return (
    <Box className={`work-event activity-tone--${tone}`}>
      <Box className="work-event__topline">
        <strong>{type.label}</strong>
        {props.orderMaterial && <span className="work-event__tag">Order material</span>}
        {props.variant === 'install-only' && <span className="work-event__tag">Install only</span>}
      </Box>
      <span className="work-event__community">#{props.jobCode} · {props.community}</span>
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
        <Typography variant="body2" fontWeight={650}>{children || 'Unassigned'}</Typography>
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
      <Typography variant="caption" color="text.secondary">
        {getLotsLabel(lotStart, lotEnd)} · All day
      </Typography>
    </Box>
  )
}

function StageScheduleDetail({ activityType, schedule, lotStart, lotEnd }) {
  const type = activityTypeMap[activityType]
  const tone = getActivityTone(activityType, schedule.orderMaterial)
  const schedules = schedule.splitPhase
    ? schedule.splitParts
    : [{ id: `${activityType}-base`, lotStart, lotEnd, date: schedule.date }]
  const optionLabels = [
    schedule.orderMaterial && 'Order material',
    schedule.installOnly && 'Install only',
    schedule.splitPhase && 'Split phase',
    schedule.shutters && 'Shutters',
    schedule.lockUp && 'Lock up',
  ].filter(Boolean)

  return (
    <Box className="activity-detail__stage">
      <Box className="activity-detail__stage-heading">
        <Box className={`activity-stage-title activity-tone--${tone}`}>
          <span className="activity-stage-title__dot" />
          <Typography variant="subtitle2" fontWeight={800}>{type.label}</Typography>
        </Box>
        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {optionLabels.map((label) => <Chip key={label} size="small" label={label} />)}
        </Stack>
      </Box>
      <Stack spacing={0.75}>
        {schedules.map((part, index) => (
          <ScheduleRow
            key={part.id ?? `${activityType}-${index}`}
            label={schedule.splitPhase ? `Division ${index + 1}` : type.label}
            lotStart={part.lotStart}
            lotEnd={part.lotEnd}
            date={part.date}
            tone={tone}
          />
        ))}
        {schedule.installOnly && (
          <ScheduleRow
            label="Install only"
            lotStart={lotStart}
            lotEnd={lotEnd}
            date={schedule.installDate}
            tone={tone}
          />
        )}
      </Stack>
    </Box>
  )
}

function ActivityDetail({ event, onClose, onEdit }) {
  if (!event) return null

  const props = event.extendedProps
  const type = activityTypeMap[props.activityType]
  const tone = getActivityTone(props.activityType, props.orderMaterial)
  const lotStart = props.lotNumbers?.[0] ?? props.lotStart
  const lotEnd = props.lotNumbers?.at(-1) ?? props.lotEnd

  return (
    <Box className="activity-drawer__layout">
      <DrawerHeader eyebrow="PRODUCTION ACTIVITY" title={`Job #${props.jobCode}`} onClose={onClose} />

      <Box className="activity-drawer__scroll">
        <Box className={`activity-detail__hero activity-tone--${tone}`}>
          <Box className="activity-detail__type-mark">{type.shortLabel}</Box>
          <Box>
            <Typography variant="h6" fontWeight={780}>{type.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {props.phase} · {getLotsLabel(lotStart, lotEnd)}
            </Typography>
          </Box>
          <Chip size="small" label="Production" className="activity-detail__chip" />
        </Box>

        <Box className="activity-detail__grid">
          <DetailRow icon={<BusinessRoundedIcon />} label="Builder">{props.builder}</DetailRow>
          <DetailRow icon={<LocationOnOutlinedIcon />} label="Community">{props.community}</DetailRow>
          <DetailRow icon={<LayersOutlinedIcon />} label="Phase">{props.phase}</DetailRow>
          <DetailRow icon={<ApartmentRoundedIcon />} label="Building">{props.building}</DetailRow>
          <DetailRow icon={<EngineeringRoundedIcon />} label="Foreman / Supervisor">{props.foreman}</DetailRow>
          <DetailRow icon={<EngineeringRoundedIcon />} label="Jobsite Superintendent">{props.superintendent}</DetailRow>
        </Box>

        <Divider />

        <Box className="activity-detail__section">
          <Box className="activity-detail__section-title">
            <Box>
              <Typography variant="subtitle1" fontWeight={750}>Production schedule</Typography>
              <Typography variant="caption" color="text.secondary">EXT, DM and HW are managed together.</Typography>
            </Box>
            <Chip size="small" label="3 events" />
          </Box>
          <Stack spacing={1.5}>
            {activityTypeOptions.map((stage) => (
              <StageScheduleDetail
                key={stage.value}
                activityType={stage.value}
                schedule={props.productionSchedule[stage.value]}
                lotStart={lotStart}
                lotEnd={lotEnd}
              />
            ))}
          </Stack>
        </Box>

        {props.notes && (
          <Paper variant="outlined" className="activity-detail__notes">
            <Typography variant="caption" color="text.secondary" fontWeight={750}>NOTES</Typography>
            <Typography variant="body2">{props.notes}</Typography>
          </Paper>
        )}
      </Box>

      <Box className="activity-drawer__footer">
        <Button variant="outlined" color="inherit" onClick={onClose}>Close</Button>
        <Button variant="contained" startIcon={<EditOutlinedIcon />} onClick={onEdit} disableElevation>
          Edit production
        </Button>
      </Box>
    </Box>
  )
}

function AutoField({ label, value }) {
  return (
    <Box className="production-summary__field">
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={700}>{value || 'Unassigned'}</Typography>
    </Box>
  )
}

function ProductionSummary({ draft }) {
  return (
    <Paper variant="outlined" className="production-summary">
      <Box className="production-summary__heading">
        <Box>
          <Typography variant="subtitle2" fontWeight={800}>Loaded from Job #{draft.jobCode}</Typography>
          <Typography variant="caption" color="text.secondary">These fields update automatically with the selected phase.</Typography>
        </Box>
        <Chip size="small" color="success" variant="outlined" label={`${draft.lotNumbers.length} lots`} />
      </Box>
      <Box className="production-summary__grid">
        <AutoField label="Builder" value={draft.builder} />
        <AutoField label="Community" value={draft.community} />
        <AutoField label="Building" value={draft.building} />
        <AutoField label="Lot range" value={getLotsLabel(draft.lotStart, draft.lotEnd)} />
        <AutoField label="Foreman / Supervisor" value={draft.foreman} />
        <AutoField label="Jobsite Superintendent" value={draft.superintendent} />
      </Box>
      <Box className="production-summary__lots" aria-label="Lots loaded from selected phase">
        {draft.lotNumbers.map((lot) => <Chip key={lot} size="small" label={`Lot ${lot}`} />)}
      </Box>
    </Paper>
  )
}

function OptionCheckbox({ checked, disabled = false, label, description, onChange, endAdornment = null }) {
  return (
    <FormControlLabel
      disabled={disabled}
      control={<Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />}
      label={(
        <Box className="activity-option-label">
          <Box>
            <Typography variant="body2" fontWeight={700}>{label}</Typography>
            <Typography variant="caption" color="text.secondary">{description}</Typography>
          </Box>
          {endAdornment}
        </Box>
      )}
    />
  )
}

function SplitScheduleEditor({ activityType, parts, totalLots, onChange, onReset }) {
  const type = activityTypeMap[activityType]
  const canAddDivision = parts.length < totalLots

  return (
    <Box className="stage-split-editor">
      <Box className="activity-form__heading activity-form__heading--actions">
        <Box>
          <Typography variant="subtitle2" fontWeight={800}>Split schedule</Typography>
          <Typography variant="caption" color="text.secondary">Each division becomes an all-day calendar event.</Typography>
        </Box>
        <Stack direction="row" spacing={0.5}>
          <Button size="small" onClick={onReset}>Reset</Button>
          <Button
            size="small"
            startIcon={<AddRoundedIcon />}
            disabled={!canAddDivision}
            onClick={() => onChange(addSplitDivision(parts))}
          >
            Division
          </Button>
        </Stack>
      </Box>
      <Stack spacing={1}>
        {parts.map((part, index) => (
          <Paper key={part.id} variant="outlined" className={`split-part activity-tone--${type.tone}`}>
            <Box className="split-part__heading">
              <Typography variant="caption" fontWeight={800}>DIVISION {index + 1}</Typography>
              <IconButton
                size="small"
                aria-label={`Remove division ${index + 1}`}
                disabled={parts.length <= 2}
                onClick={() => onChange(removeSplitDivision(parts, index))}
              >
                <DeleteOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box className="split-part__fields">
              <TextField
                label="From"
                type="number"
                value={part.lotStart}
                onChange={(event) => onChange(parts.map((item) => item.id === part.id
                  ? { ...item, lotStart: event.target.value }
                  : item))}
                slotProps={{ htmlInput: { min: 1 } }}
                required
              />
              <TextField
                label="To"
                type="number"
                value={part.lotEnd}
                onChange={(event) => onChange(parts.map((item) => item.id === part.id
                  ? { ...item, lotEnd: event.target.value }
                  : item))}
                slotProps={{ htmlInput: { min: 1 } }}
                required
              />
              <TextField
                label="Date"
                type="date"
                value={part.date}
                onChange={(event) => onChange(parts.map((item) => item.id === part.id
                  ? { ...item, date: event.target.value }
                  : item))}
                slotProps={{ inputLabel: { shrink: true } }}
                required
              />
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}

function StageCard({ activityType, date, onDateChange, tone, children }) {
  const type = activityTypeMap[activityType]

  return (
    <Paper variant="outlined" className={`production-stage-card activity-tone--${tone}`}>
      <Box className="production-stage-card__header">
        <Box className="production-stage-card__identity">
          <span className="production-stage-card__number">{activityType}</span>
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>{type.label}</Typography>
            <Typography variant="caption" color="text.secondary">{type.description}</Typography>
          </Box>
        </Box>
        <TextField
          label={`${activityType} date`}
          type="date"
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          required
          size="small"
          className="production-stage-card__date"
        />
      </Box>
      {children}
    </Paper>
  )
}

function ActivityForm({ jobs, draft, isEditing, formError, onChange, onClose, onSave }) {
  const selectedJob = jobs.find((job) => job.id === Number(draft.jobId)) ?? null
  const phases = selectedJob?.sequenceSheet?.phases ?? []
  const totalLots = draft.lotNumbers.length

  const changeJob = (jobId) => {
    const job = jobs.find((item) => item.id === Number(jobId)) ?? null
    onChange({
      ...getPhasePatch(job, null),
      jobId: job?.id ?? '',
    })
  }

  const changePhase = (phaseId) => {
    const phase = phases.find((item) => item.id === Number(phaseId)) ?? null
    onChange(getPhasePatch(selectedJob, phase))
  }

  const toggleSplit = (prefix, checked, date) => {
    const partsField = `${prefix}SplitParts`
    onChange({
      [`${prefix}SplitPhase`]: checked,
      [partsField]: checked ? createDefaultSplitParts(draft, date) : [],
    })
  }

  return (
    <Box component="form" className="activity-drawer__layout" onSubmit={onSave}>
      <DrawerHeader
        eyebrow={isEditing ? 'EDIT PRODUCTION' : 'NEW PRODUCTION ACTIVITY'}
        title={isEditing ? 'Edit production' : 'Schedule production'}
        onClose={onClose}
      />

      <Box className="activity-drawer__scroll">
        {formError && <Alert severity="error">{formError}</Alert>}

        <Box className="activity-form__section">
          <Box className="activity-form__heading">
            <Box>
              <Typography variant="subtitle2" fontWeight={800}>Job and phase</Typography>
              <Typography variant="caption" color="text.secondary">Choose these two fields; project and staff data load automatically.</Typography>
            </Box>
          </Box>
          <Box className="activity-form__grid">
            <TextField
              select
              label="Job"
              value={draft.jobId}
              onChange={(event) => changeJob(event.target.value)}
              required
              fullWidth
            >
              <MenuItem value="">Select a job</MenuItem>
              {jobs.map((job) => (
                <MenuItem key={job.id} value={job.id}>
                  #{job.code} · {job.community} · {job.builder}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Phase"
              value={draft.phaseId}
              onChange={(event) => changePhase(event.target.value)}
              disabled={!selectedJob || phases.length === 0}
              required
              fullWidth
            >
              <MenuItem value="">Select a phase</MenuItem>
              {phases.map((phase) => (
                <MenuItem key={phase.id} value={phase.id}>
                  {formatPhase(phase.name)} · {formatBuilding(phase.building)} · {phase.lots?.length ?? 0} lots
                </MenuItem>
              ))}
            </TextField>
          </Box>
          {selectedJob && phases.length === 0 && (
            <Alert severity="warning">This job has no phases yet. Add a phase and its lots in Sequence Sheets first.</Alert>
          )}
        </Box>

        {draft.phaseId && <ProductionSummary draft={draft} />}

        <Divider />

        <Box className="activity-form__section">
          <Box className="activity-form__heading">
            <Box>
              <Typography variant="subtitle2" fontWeight={800}>Production dates</Typography>
              <Typography variant="caption" color="text.secondary">Saving creates EXT, DM and HW together.</Typography>
            </Box>
            <Chip size="small" label="3 events" color="primary" variant="outlined" />
          </Box>

          <Stack spacing={1.5}>
            <StageCard
              activityType="EXT"
              tone={getActivityTone('EXT', draft.extOrderMaterial)}
              date={draft.extDate}
              onDateChange={(value) => onChange({ extDate: value })}
            >
              <Box className="activity-options-card">
                <OptionCheckbox
                  checked={draft.extOrderMaterial}
                  label="Order Material"
                  description="Mark the EXT event yellow when material must be ordered."
                  onChange={(checked) => onChange({ extOrderMaterial: checked })}
                />
                <OptionCheckbox
                  checked={draft.extInstallOnly}
                  label="Install only"
                  description="Add a separate EXT install-only event."
                  onChange={(checked) => onChange({
                    extInstallOnly: checked,
                    extInstallDate: checked ? (draft.extInstallDate || draft.extDate) : '',
                  })}
                />
                {draft.extInstallOnly && (
                  <TextField
                    label="EXT install-only date"
                    type="date"
                    value={draft.extInstallDate}
                    onChange={(event) => onChange({ extInstallDate: event.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                    fullWidth
                    required
                    size="small"
                    className="activity-option-date"
                  />
                )}
              </Box>
            </StageCard>

            <StageCard
              activityType="DM"
              tone="dm"
              date={draft.dmDate}
              onDateChange={(value) => onChange({ dmDate: value })}
            >
              <Box className="activity-options-card">
                <OptionCheckbox
                  checked={draft.dmInstallOnly}
                  label="Install only"
                  description="Add a separate DM install-only event."
                  onChange={(checked) => onChange({
                    dmInstallOnly: checked,
                    dmInstallDate: checked ? (draft.dmInstallDate || draft.dmDate) : '',
                  })}
                />
                {draft.dmInstallOnly && (
                  <TextField
                    label="DM install-only date"
                    type="date"
                    value={draft.dmInstallDate}
                    onChange={(event) => onChange({ dmInstallDate: event.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                    fullWidth
                    required
                    size="small"
                    className="activity-option-date"
                  />
                )}
                <OptionCheckbox
                  checked={draft.dmSplitPhase}
                  disabled={totalLots < 2}
                  label="Split phase"
                  description="Schedule groups of lots on different dates."
                  onChange={(checked) => toggleSplit('dm', checked, draft.dmDate)}
                />
                <OptionCheckbox
                  checked={draft.dmShutters}
                  label="Shutters"
                  description="Include shutters in the DM scope."
                  onChange={(checked) => onChange({ dmShutters: checked })}
                />
              </Box>
              {draft.dmSplitPhase && (
                <SplitScheduleEditor
                  activityType="DM"
                  parts={draft.dmSplitParts}
                  totalLots={totalLots}
                  onChange={(parts) => onChange({ dmSplitParts: parts })}
                  onReset={() => onChange({ dmSplitParts: createDefaultSplitParts(draft, draft.dmDate) })}
                />
              )}
            </StageCard>

            <StageCard
              activityType="HW"
              tone="hw"
              date={draft.hwDate}
              onDateChange={(value) => onChange({ hwDate: value })}
            >
              <Box className="activity-options-card">
                <OptionCheckbox
                  checked={draft.hwSplitPhase}
                  disabled={totalLots < 2}
                  label="Split phase"
                  description="Schedule groups of lots on different dates."
                  onChange={(checked) => toggleSplit('hw', checked, draft.hwDate)}
                />
                <OptionCheckbox
                  checked={false}
                  disabled
                  label="Lock up"
                  description="Hardware lock-up workflow."
                  onChange={() => {}}
                  endAdornment={<Chip size="small" label="Pending" />}
                />
              </Box>
              {draft.hwSplitPhase && (
                <SplitScheduleEditor
                  activityType="HW"
                  parts={draft.hwSplitParts}
                  totalLots={totalLots}
                  onChange={(parts) => onChange({ hwSplitParts: parts })}
                  onReset={() => onChange({ hwSplitParts: createDefaultSplitParts(draft, draft.hwDate) })}
                />
              )}
            </StageCard>
          </Stack>
        </Box>

        <Box className="activity-form__section">
          <TextField
            label="Notes"
            value={draft.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
            multiline
            rows={3}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </Box>

        <Alert severity="info" icon={<EventAvailableRoundedIcon />}>
          All production events are all-day. Edit this activity to reschedule any stage.
        </Alert>
      </Box>

      <Box className="activity-drawer__footer">
        <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation>
          {isEditing ? 'Save changes' : 'Create 3 events'}
        </Button>
      </Box>
    </Box>
  )
}

function ChangeOrdersPlaceholder() {
  return (
    <Paper variant="outlined" className="change-orders-placeholder activity-tone--change-order">
      <Box className="change-orders-placeholder__icon">
        <EventAvailableRoundedIcon />
      </Box>
      <Chip size="small" label="PENDING" color="success" variant="outlined" />
      <Typography variant="h5" fontWeight={800}>Extra / Change Orders</Typography>
      <Typography color="text.secondary" align="center">
        This workspace is reserved for extra work and change orders. Its events will use green when scheduling is enabled.
      </Typography>
      <Box className="change-orders-placeholder__legend">
        <span />
        Extra / Change Order event
      </Box>
    </Paper>
  )
}

export default function CalendarScheduler() {
  const calendarRef = useRef(null)
  const { jobs } = useJobs()
  const { mode, systemMode } = useColorScheme()
  const resolvedColorMode = mode === 'system' ? systemMode : mode
  const [calendarMode, setCalendarMode] = useState('PRODUCTION')
  const [events, setEvents] = useState(initialCalendarEvents)
  const [selectedId, setSelectedId] = useState(null)
  const [drawerMode, setDrawerMode] = useState(null)
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [draft, setDraft] = useState(createEmptyProductionDraft())
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [viewTitle, setViewTitle] = useState('Aug 10 – 14, 2026')
  const [viewType, setViewType] = useState('dayGridWeek')
  const [visibleTypes, setVisibleTypes] = useState(['EXT', 'DM', 'HW'])

  const filteredEvents = useMemo(() => events.filter((event) => (
    visibleTypes.includes(event.extendedProps.activityType)
  )), [events, visibleTypes])

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null

  const closeDrawer = () => {
    setDrawerMode(null)
    setSelectedId(null)
    setEditingGroupId(null)
    setFormError('')
  }

  const openCreateDrawer = () => {
    setSelectedId(null)
    setEditingGroupId(null)
    setDraft(createEmptyProductionDraft())
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

    const groupId = selectedEvent.extendedProps.groupId ?? selectedEvent.groupId ?? selectedEvent.id
    setDraft(createDraftFromProductionEvent(selectedEvent))
    setEditingGroupId(groupId)
    setFormError('')
    setDrawerMode('edit')
  }

  const saveActivity = (event) => {
    event.preventDefault()
    const result = calendarEventSchema.safeParse(draft)

    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? 'Review the production details.')
      return
    }

    const groupId = editingGroupId ?? `production-${Date.now()}`
    const nextEvents = createProductionCalendarEvents(result.data, groupId)
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
    setNotice(editingGroupId
      ? 'Production activity updated.'
      : 'Production activity created with EXT, DM and HW.')
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

  const changeCalendarMode = (_, nextMode) => {
    if (!nextMode) return
    closeDrawer()
    setCalendarMode(nextMode)
  }

  return (
    <Box className="calendar-page">
      <Box className="calendar-page__header">
        <Box>
          <Typography variant="h4" fontWeight={780} letterSpacing="-0.025em">Calendar</Typography>
          <Typography color="text.secondary">
            {calendarMode === 'PRODUCTION'
              ? 'Schedule EXT, DM and HW as one production activity.'
              : 'Track extra work and change orders separately.'}
          </Typography>
        </Box>

        <Box className="calendar-page__actions">
          <ToggleButtonGroup
            exclusive
            value={calendarMode}
            onChange={changeCalendarMode}
            size="small"
            aria-label="Calendar section"
            className="calendar-mode-toggle"
          >
            <ToggleButton value="PRODUCTION">Production</ToggleButton>
            <ToggleButton value="CHANGE_ORDERS">Extra / Change Orders</ToggleButton>
          </ToggleButtonGroup>
          {calendarMode === 'PRODUCTION' ? (
            <ResponsiveCreateButton label="New activity" onClick={openCreateDrawer} />
          ) : (
            <Tooltip title="Extra / Change Orders is pending">
              <span><Button variant="contained" disabled>New change order</Button></span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {calendarMode === 'PRODUCTION' ? (
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
                      onChange={() => toggleType(type.value)}
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
                <span>All-day activities · Open any event to view or edit its full Production group</span>
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
                    const tone = getActivityTone(event.extendedProps.activityType, event.extendedProps.orderMaterial)
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
        </>
      ) : (
        <Box className="calendar-workspace calendar-workspace--placeholder">
          <ChangeOrdersPlaceholder type={changeOrderType} />
        </Box>
      )}

      <Drawer
        anchor="right"
        open={Boolean(drawerMode)}
        onClose={closeDrawer}
        slotProps={{
          paper: {
            className: 'activity-drawer',
            style: {
              '--drawer-surface': resolvedColorMode === 'dark' ? '#1e293b' : '#ffffff',
            },
            sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' },
          },
        }}
      >
        {drawerMode === 'detail' ? (
          <ActivityDetail event={selectedEvent} onClose={closeDrawer} onEdit={openEditDrawer} />
        ) : (
          <ActivityForm
            jobs={jobs}
            draft={draft}
            isEditing={drawerMode === 'edit'}
            formError={formError}
            onChange={(draftPatch) => {
              setDraft((current) => ({ ...current, ...draftPatch }))
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
