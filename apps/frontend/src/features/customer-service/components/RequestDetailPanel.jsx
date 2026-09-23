import {
  Box,
  Button,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import PhoneRoundedIcon from '@mui/icons-material/PhoneRounded'
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined'
import { formatPhoneNumber } from '../../../utils/phoneNumbers.js'
import Pill from './Pill.jsx'
import {
  appointmentStateLabels,
  isClosed,
  prioritiesByValue,
  requestTagsByValue,
  requestTypeLabels,
  statusesByValue,
} from '../data/customerService.js'
import { formatLongDate, formatShortDate, formatTime } from '../utils/dates.js'
import { suggestServiceWorkdays } from '../utils/suggestedServiceWindows.js'

const workTypeLabels = {
  HW: 'HW',
  WS: 'WS',
  HW_WS: 'HW & WS',
}

const distanceColors = {
  GREEN: 'success.main',
  YELLOW: 'warning.main',
  RED: 'error.main',
}

function Field({ label, children }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Box sx={{ mt: 0.25 }}>{children}</Box>
    </Box>
  )
}

function TextValue({ label, value }) {
  return (
    <Field label={label}>
      <Typography variant="body2" color="text.primary">
        {value || '—'}
      </Typography>
    </Field>
  )
}

function PanelCard({ title, action, children }) {
  return (
    <Box
      sx={{
        bgcolor: 'sidebar.bg',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.75 }}
      >
        <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
        {action}
      </Stack>
      <Stack spacing={1.75}>{children}</Stack>
    </Box>
  )
}

function formatAvailability(value) {
  if (!value) return ''
  const [date, time] = value.split('T')
  return `${formatLongDate(date)} at ${formatTime(time)}`
}

export default function RequestDetailPanel({ request, settings, onClose, onEdit }) {
  const status = statusesByValue[request.status] ?? {
    label: request.status,
    color: 'neutral',
  }
  const tag = requestTagsByValue[request.tag]
  const priority = prioritiesByValue[request.priority]
  const closed = isClosed(request)
  const hasAppointment = request.appointmentState !== 'NOT_SCHEDULED'
  const coordinates = request.latitude !== null && request.longitude !== null
    ? `${request.latitude}, ${request.longitude}`
    : ''
  const suggestions = suggestServiceWorkdays(
    request.createdAt,
    settings,
    new Date(),
    request.dueOn,
  )

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">Service Request</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}>
              <Typography variant="h6" fontWeight={700}>{request.requestNumber}</Typography>
              <Pill label={status.label} color={status.color} />
              {tag && <Pill dense label={tag.label} color={tag.color} />}
            </Stack>
          </Box>
          <IconButton size="small" aria-label="Close details" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="outlined"
            component="a"
            href={`tel:${request.contactPhone}`}
            startIcon={<PhoneRoundedIcon />}
          >
            Call
          </Button>
          <Button
            size="small"
            variant="outlined"
            component="a"
            href={`sms:${request.contactPhone}`}
            startIcon={<SmsOutlinedIcon />}
          >
            Text
          </Button>
          {request.contactEmail && (
            <Button
              size="small"
              variant="outlined"
              component="a"
              href={`mailto:${request.contactEmail}`}
              startIcon={<EmailOutlinedIcon />}
            >
              Email
            </Button>
          )}
        </Stack>

        <Stack direction="row" spacing={3} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
          <TextValue label="Created" value={formatShortDate(suggestions.createdOn)} />
          <TextValue label="Reported" value={formatShortDate(request.reportedAt)} />
          <TextValue label="Due" value={formatShortDate(request.dueOn)} />
        </Stack>
      </Box>

      <Box sx={{ p: 2.5 }}>
        <Typography variant="body2" fontWeight={700}>
          {request.street}
        </Typography>
        {(request.builderName || request.community || request.lotNumber) && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {[request.builderName, request.community, request.lotNumber && `Lot ${request.lotNumber}`]
              .filter(Boolean).join(' · ')}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {[request.city, request.state, request.postalCode].filter(Boolean).join(', ')}
          {request.plan ? ` · ${request.plan}` : ''}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" fontWeight={700}>{request.contactName}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {formatPhoneNumber(request.contactPhone)}
        </Typography>
        <Typography variant="body2" color="text.secondary">{request.contactEmail}</Typography>

        <Stack spacing={2} sx={{ mt: 2.5 }}>
          <PanelCard
            title="Request information"
            action={closed ? (
              <Typography variant="caption" color="text.secondary">
                Closed {formatShortDate(request.closedAt?.slice(0, 10))}
              </Typography>
            ) : (
              <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => onEdit(request)}>
                Edit
              </Button>
            )}
          >
            <TextValue label="Issue" value={request.issue} />
            <TextValue label="Classification" value={requestTypeLabels[request.type]} />
            <TextValue label="Work type" value={workTypeLabels[request.workType]} />
            <TextValue
              label="Estimated duration"
              value={request.estimatedDurationMinutes
                ? `${request.estimatedDurationMinutes} minutes`
                : ''}
            />
            <Field label="Priority">
              <Typography variant="body2" fontWeight={600} sx={{ color: priority?.color }}>
                {priority?.label ?? request.priority}
              </Typography>
            </Field>
            <TextValue label="Internal notes" value={request.internalNotes} />
            {closed && <TextValue label="Close reason" value={request.closeReason} />}
          </PanelCard>

          <PanelCard title="Location and distance">
            <TextValue label="Coordinates" value={coordinates} />
            <Field label="Straight-line distance from Valtrim">
              <Typography
                variant="body2"
                fontWeight={700}
                sx={{ color: distanceColors[request.distanceBand] ?? 'text.primary' }}
              >
                {request.distanceMiles === null
                  ? '—'
                  : `${request.distanceMiles.toFixed(1)} miles · ${request.distanceBand.toLowerCase()}`}
              </Typography>
            </Field>
            {coordinates && (
              <Button
                size="small"
                variant="outlined"
                component="a"
                href={`https://www.google.com/maps/search/?api=1&query=${request.latitude},${request.longitude}`}
                target="_blank"
                rel="noreferrer"
                startIcon={<MapOutlinedIcon />}
                sx={{ alignSelf: 'flex-start' }}
              >
                Open coordinates
              </Button>
            )}
          </PanelCard>

          <PanelCard title="Suggested visit days">
            <Typography variant="body2" color="text.secondary">
              Workday proposals only; the customer has not confirmed these times.
            </Typography>
            {suggestions.days.length ? suggestions.days.map((day) => (
              <Typography key={day.date} variant="body2">
                {formatLongDate(day.date)} · {formatTime(day.availableFrom.slice(11))}
                {' – '}{formatTime(day.availableUntil.slice(11))}
              </Typography>
            )) : (
              <Typography variant="body2" color="text.secondary">
                No workday remains before this request's deadline.
              </Typography>
            )}
          </PanelCard>

          <PanelCard title="Customer availability">
            {request.availability.length ? request.availability.map((window, index) => (
              <Box key={window.id ?? `${window.availableFrom}-${index}`}>
                <Typography variant="body2" fontWeight={600}>
                  {formatAvailability(window.availableFrom)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Until {formatAvailability(window.availableUntil)}
                </Typography>
                {window.notes && (
                  <Typography variant="caption" color="text.secondary">
                    {window.notes}
                  </Typography>
                )}
              </Box>
            )) : (
              <Typography variant="body2" color="text.secondary">No availability registered.</Typography>
            )}
            <TextValue label="General notes" value={request.customerAvailabilityNotes} />
          </PanelCard>

          <PanelCard title="Appointment">
            <TextValue
              label="State"
              value={appointmentStateLabels[request.appointmentState] ?? request.appointmentState}
            />
            {hasAppointment && request.appointmentDate && (
              <TextValue label="Date" value={formatLongDate(request.appointmentDate)} />
            )}
            {request.appointmentStart && request.appointmentEnd && (
              <TextValue
                label="Arrival window"
                value={`${formatTime(request.appointmentStart)} – ${formatTime(request.appointmentEnd)}`}
              />
            )}
            <TextValue label="Technician" value={request.technicianName} />
            <TextValue label="Customer confirmation" value={request.confirmationStatus} />
          </PanelCard>
        </Stack>
      </Box>
    </Box>
  )
}
