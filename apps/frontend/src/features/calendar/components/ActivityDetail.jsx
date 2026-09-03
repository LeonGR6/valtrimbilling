import {
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EngineeringRoundedIcon from '@mui/icons-material/EngineeringRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined'
import {
  activityTypeMap,
  getActivityTone,
  getDateOwnerLabel,
  getLotsLabel,
} from '../data/calendarEvents.js'
import DrawerHeader from './DrawerHeader.jsx'
import { formatDate } from './calendarSchedulerUtils.js'

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

const changeDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatChangeDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : changeDateFormatter.format(date)
}

function ScheduleRow({ label, lotStart, lotEnd, lotNumbers, date, dateOwner, note, tone }) {
  return (
    <Box className={`schedule-row activity-tone--${tone}`}>
      <Box className="schedule-row__date">
        <Box className="schedule-row__date-value">
          <CalendarMonthRoundedIcon fontSize="small" />
          <span>{formatDate(date)}</span>
        </Box>
        <span className="schedule-row__owner">{getDateOwnerLabel(dateOwner)}</span>
      </Box>
      <Typography variant="body2" fontWeight={750}>{label}</Typography>
      <Typography variant="caption" color="text.secondary">
        {getLotsLabel(lotStart, lotEnd, lotNumbers)} · All day
      </Typography>
      {note && (
        <Typography variant="body2" className="schedule-row__note">
          {note}
        </Typography>
      )}
    </Box>
  )
}

function DateHistory({ history, tone }) {
  if (!history?.length) return null

  return (
    <Box className="activity-detail__section">
      <Box className="activity-detail__section-title">
        <Box>
          <Typography variant="subtitle1" fontWeight={750}>Date change history</Typography>
          <Typography variant="caption" color="text.secondary">
            Previous date, date type and note for this event.
          </Typography>
        </Box>
        <Chip size="small" icon={<HistoryRoundedIcon />} label={history.length} />
      </Box>
      <Stack spacing={0.75}>
        {[...history].reverse().map((entry, index) => (
          <Paper
            key={`${entry.changedAt}-${entry.date}-${index}`}
            variant="outlined"
            className={`date-history-row activity-tone--${tone}`}
          >
            <Box className="date-history-row__heading">
              <Box className="date-history-row__date">
                <CalendarMonthRoundedIcon fontSize="small" />
                <Typography variant="body2" fontWeight={750}>{formatDate(entry.date)}</Typography>
              </Box>
              <Chip size="small" variant="outlined" label={getDateOwnerLabel(entry.dateOwner)} />
            </Box>
            <Typography variant="body2" color={entry.note ? 'text.primary' : 'text.secondary'}>
              {entry.note || 'No note was saved for this date.'}
            </Typography>
            {formatChangeDate(entry.changedAt) && (
              <Typography variant="caption" color="text.secondary">
                Replaced {formatChangeDate(entry.changedAt)}
              </Typography>
            )}
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}

function StageScheduleDetail({ activityType, schedule, lotStart, lotEnd, lotNumbers }) {
  const type = activityTypeMap[activityType]
  const tone = getActivityTone(activityType, schedule.orderMaterial)
  const schedules = schedule.splitPhase
    ? schedule.splitParts.map((part) => ({
      ...part,
      lotNumbers: lotNumbers.filter((lot) => (
        Number(lot) >= Number(part.lotStart) && Number(lot) <= Number(part.lotEnd)
      )),
    }))
    : [{
      id: `${activityType}-base`,
      lotStart,
      lotEnd,
      lotNumbers,
      date: schedule.date,
      dateOwner: schedule.dateOwner,
      note: schedule.note,
    }]
  const optionLabels = [
    schedule.orderMaterial && 'Order material',
    schedule.installOnly && 'Install only',
    schedule.splitPhase && 'Split phase',
    schedule.shutters && 'Shutter',
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
            lotNumbers={part.lotNumbers}
            date={part.date}
            dateOwner={part.dateOwner ?? schedule.dateOwner}
            note={part.note ?? schedule.note}
            tone={tone}
          />
        ))}
        {schedule.installOnly && (
          <ScheduleRow
            label="Install only"
            lotStart={lotStart}
            lotEnd={lotEnd}
            lotNumbers={lotNumbers}
            date={schedule.installDate}
            dateOwner={schedule.installDateOwner}
            note={schedule.installDateNote}
            tone={tone}
          />
        )}
      </Stack>
    </Box>
  )
}

export default function ActivityDetail({ event, onClose, onEdit }) {
  if (!event) return null

  const props = event.extendedProps
  const type = activityTypeMap[props.activityType]
  const tone = getActivityTone(props.activityType, props.orderMaterial)
  const phaseLotNumbers = props.phaseLotNumbers ?? props.lotNumbers ?? []
  const lotStart = phaseLotNumbers[0] ?? props.lotStart
  const lotEnd = phaseLotNumbers.at(-1) ?? props.lotEnd

  return (
    <Box className="activity-drawer__layout">
      <DrawerHeader eyebrow="PRODUCTION ACTIVITY" title={`Job #${props.jobCode}`} onClose={onClose} />

      <Box className="activity-drawer__scroll">
        <Box className={`activity-detail__hero activity-tone--${tone}`}>
          <Box className="activity-detail__type-mark">{type.shortLabel}</Box>
          <Box>
            <Typography variant="h6" fontWeight={780}>{type.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {props.phase} · {getLotsLabel(lotStart, lotEnd, phaseLotNumbers)}
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
              <Typography variant="subtitle1" fontWeight={750}>{type.label} schedule</Typography>
              <Typography variant="caption" color="text.secondary">Options and dates for the selected event.</Typography>
            </Box>
            <Chip size="small" label={type.shortLabel} />
          </Box>
          <StageScheduleDetail
            activityType={props.activityType}
            schedule={props.productionSchedule[props.activityType]}
            lotStart={lotStart}
            lotEnd={lotEnd}
            lotNumbers={phaseLotNumbers}
          />
        </Box>

        <DateHistory history={props.dateHistory} tone={tone} />

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
          Configure {type.shortLabel}
        </Button>
      </Box>
    </Box>
  )
}
