import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
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

function formatInternalSlot(event) {
  const slot = event.extendedProps.internalSlot
  if (!slot?.start || !slot?.end) return ''
  const date = event.start instanceof Date ? event.start : new Date(event.start)
  const [startHours, startMinutes] = slot.start.split(':').map(Number)
  const [endHours, endMinutes] = slot.end.split(':').map(Number)
  const start = new Date(date)
  const end = new Date(date)
  start.setHours(startHours, startMinutes, 0, 0)
  end.setHours(endHours, endMinutes, 0, 0)
  return `${timeFormatter.format(start)}–${timeFormatter.format(end)}`
}

// A saved appointment can be cancelled with a reason; the request returns to
// Ready to propose so it can be planned again. Rescheduling is cancel + register.
function CancelAppointment({ appointment, requestNumber, onCancelled }) {
  const { cancelAppointment } = useCustomerServicePrototype()
  const [dialog, setDialog] = useState(null)
  const submit = async () => {
    setDialog((current) => ({ ...current, saving: true, error: '' }))
    try {
      await cancelAppointment({
        appointmentId: appointment.id, expectedUpdatedAt: appointment.updatedAt, reason: dialog.reason,
      })
      setDialog(null)
      onCancelled()
    } catch (error) {
      setDialog((current) => ({ ...current, saving: false, error: error.message }))
    }
  }
  return (
    <>
      <Button variant="outlined" color="error" onClick={() => setDialog({ reason: '', saving: false, error: '' })}>
        Cancel appointment
      </Button>
      <Dialog open={Boolean(dialog)} onClose={() => !dialog?.saving && setDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>Cancel appointment · {requestNumber}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              The technicians&apos; time is released and the request returns to Ready to propose.
            </Typography>
            <TextField label="Cancellation reason" value={dialog?.reason ?? ''} required multiline minRows={2}
              onChange={(event) => setDialog((current) => ({ ...current, reason: event.target.value }))}
              slotProps={{ htmlInput: { maxLength: 500 } }} helperText="Required · up to 500 characters" />
            {dialog?.error && <Alert severity="error">{dialog.error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={dialog?.saving}>Keep appointment</Button>
          <Button variant="contained" color="error" onClick={submit}
            disabled={dialog?.saving || !dialog?.reason.trim()}>
            {dialog?.saving ? 'Cancelling…' : 'Cancel appointment'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

// canCancel: false shows the visit read-only (the Proposal Workspace day agenda).
export default function CustomerServiceCalendarDetail({ event, onClose, onEdit, onViewRequest, canCancel = true }) {
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
        <Field icon={<EventAvailableRoundedIcon fontSize="small" />} label="Customer arrival window">
          {formatEventDate(event)}
          {props.customerWindow?.exceptional ? ' · Exception window' : ''}
        </Field>
        {formatInternalSlot(event) && (
          <Field icon={<BuildOutlinedIcon fontSize="small" />} label="Internal planned work">
            {formatInternalSlot(event)}
          </Field>
        )}
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

        {onViewRequest && (
          <Button variant="outlined" onClick={() => onViewRequest(event)}>
            View full request
          </Button>
        )}
        {canCancel && props.appointment?.state === 'SCHEDULED' && props.status === 'CONFIRMED' && (
          <CancelAppointment appointment={props.appointment} requestNumber={props.requestNumber} onCancelled={onClose} />
        )}
        {onEdit && (
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<EditOutlinedIcon />}
            onClick={() => onEdit(event)}
          >
            Edit visit
          </Button>
        )}
      </Stack>
    </Box>
  )
}

