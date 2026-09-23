import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import HomeWorkOutlinedIcon from '@mui/icons-material/HomeWorkOutlined'
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined'
import {
  formatWorkTypes,
  serviceAppointmentStatusLabels,
} from '../data/serviceCalendarEvents.js'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

function Field({ icon, label, children }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Box sx={{ color: 'text.secondary', display: 'flex', mt: 0.25 }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          {label}
        </Typography>
        <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25 }}>
          {children || '—'}
        </Typography>
      </Box>
    </Stack>
  )
}

function formatEventDate(event) {
  const start = event.start instanceof Date ? event.start : new Date(event.start)
  const end = event.end
    ? event.end instanceof Date ? event.end : new Date(event.end)
    : null
  return `${dateFormatter.format(start)} · ${timeFormatter.format(start)}${end ? `–${timeFormatter.format(end)}` : ''}`
}

export default function CustomerServiceCalendarDetail({ event, onClose, onEdit }) {
  if (!event) return null

  const props = event.extendedProps
  const isService = props.calendarType === 'CUSTOMER_SERVICE'

  if (!isService) {
    return (
      <Box className="service-detail-panel">
        <Box className="service-detail-panel__header">
          <Box>
            <Typography variant="overline" color="text.secondary">Production activity</Typography>
            <Typography variant="h6" fontWeight={750}>Job #{props.jobCode}</Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close production details">
            <CloseRoundedIcon />
          </IconButton>
        </Box>
        <Stack spacing={2.5} sx={{ p: 3 }}>
          <Field icon={<BuildOutlinedIcon fontSize="small" />} label="Stage">
            {props.activityType}
          </Field>
          <Field icon={<HomeWorkOutlinedIcon fontSize="small" />} label="Location">
            {props.community} · {props.phase} · {props.building}
          </Field>
          <Field icon={<EventAvailableRoundedIcon fontSize="small" />} label="Scheduled date">
            {dateFormatter.format(new Date(`${event.start}T12:00:00`))}
          </Field>
          <Typography variant="body2" color="text.secondary">
            Production activities are read-only from Customer Service. Open the main Calendar to edit this group.
          </Typography>
        </Stack>
      </Box>
    )
  }

  const lastVisit = props.lastVisit

  return (
    <Box className="service-detail-panel">
      <Box className="service-detail-panel__header">
        <Box>
          <Typography variant="overline" color="text.secondary">Service request</Typography>
          <Typography variant="h6" fontWeight={750}>{props.requestNumber}</Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close service details">
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <Stack spacing={2.5} sx={{ p: 3 }}>
        <Chip
          label={serviceAppointmentStatusLabels[props.status] ?? props.status}
          color={props.status === 'OVERDUE' ? 'error' : props.status === 'COMPLETED' ? 'success' : 'primary'}
          size="small"
          sx={{ alignSelf: 'flex-start' }}
        />

        <Field icon={<PersonOutlineRoundedIcon fontSize="small" />} label="Homeowner">
          {props.homeowner}
        </Field>
        <Field icon={<HomeWorkOutlinedIcon fontSize="small" />} label="Property">
          {props.community} · Lot {props.lotNumber}
        </Field>
        <Field icon={<BuildOutlinedIcon fontSize="small" />} label="Work type">
          {formatWorkTypes(props.workTypes)}
        </Field>
        <Field icon={<EventAvailableRoundedIcon fontSize="small" />} label="Scheduled visit">
          {formatEventDate(event)}
        </Field>
        <Field icon={<PersonOutlineRoundedIcon fontSize="small" />} label="Technician">
          {props.technician}
        </Field>

        <Box className="service-detail-panel__last-visit">
          <TaskAltRoundedIcon color={lastVisit ? 'success' : 'disabled'} />
          <Box>
            <Typography variant="caption" color={lastVisit ? 'success.main' : 'text.secondary'}>
              Last completed visit
            </Typography>
            <Typography variant="body2" fontWeight={700} sx={{ mt: 0.25 }}>
              {lastVisit
                ? `${dateFormatter.format(new Date(`${lastVisit.date}T12:00:00`))} · ${formatWorkTypes(lastVisit.workTypes)}`
                : 'No previous visits'}
            </Typography>
          </Box>
        </Box>

        <Divider />

        <Box>
          <Typography variant="caption" color="text.secondary">Issue</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>{props.issue}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Notes</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>{props.notes || 'No notes added.'}</Typography>
        </Box>

        <Button
          variant="outlined"
          color="inherit"
          startIcon={<EditOutlinedIcon />}
          onClick={() => onEdit?.(event)}
        >
          Edit visit
        </Button>
      </Stack>
    </Box>
  )
}

