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
import PhoneRoundedIcon from '@mui/icons-material/PhoneRounded'
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined'
import Pill from './Pill.jsx'
import {
  appointmentStateLabels,
  builderLabelsById,
  coordinatorLabelsById,
  prioritiesByValue,
  requestTagsByValue,
  isClosed,
  requestTypeLabels,
  statusesByValue,
  technicianLabelsById,
} from '../data/customerService.js'
import { formatLongDate, formatShortDate, formatTime } from '../utils/dates.js'

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

function TextField({ label, value }) {
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
        <Typography variant="subtitle2" fontWeight={700}>
          {title}
        </Typography>
        {action}
      </Stack>
      <Stack spacing={1.75}>{children}</Stack>
    </Box>
  )
}

export default function RequestDetailPanel({ request, onClose, onEdit }) {
  const status = statusesByValue[request.status]
  const tag = requestTagsByValue[request.tag]
  const priority = prioritiesByValue[request.priority]
  const technician = technicianLabelsById[request.technicianId]
  const closed = isClosed(request)
  const isOverdue = request.appointmentState === 'OVERDUE'
  const hasVisit =
    request.appointmentState === 'SCHEDULED' ||
    request.appointmentState === 'COMPLETED'

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
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              Service Request
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}
            >
              <Typography variant="h6" fontWeight={700}>
                {request.requestNumber}
              </Typography>
              <Pill label={status.label} color={status.color} />
              {tag && <Pill dense label={tag.label} color={tag.color} />}
            </Stack>
          </Box>
          <IconButton size="small" aria-label="Close details" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>

        {/* Handing the call off to the device rather than pretending the app
            can place it. */}
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

        <Stack
          direction="row"
          spacing={2}
          sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}
        >
          <TextField
            label="Requested"
            value={formatShortDate(request.reportedAt)}
          />
          <TextField
            label="Logged by"
            value={coordinatorLabelsById[request.createdById]}
          />
        </Stack>
      </Box>

      <Box sx={{ p: 2.5 }}>
        <Typography variant="body2" fontWeight={700}>
          {builderLabelsById[request.builder] ?? request.builder} ·{' '}
          {request.community} · Lot {request.lotNumber}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {request.street}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {request.city}, {request.state} {request.postalCode}
          {request.plan ? ` · ${request.plan}` : ''}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" fontWeight={700}>
          {request.contactName}{' '}
          <Box
            component="span"
            sx={{ color: 'text.secondary', fontWeight: 400 }}
          >
            (Homeowner)
          </Box>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {request.contactPhone}
        </Typography>
        {request.contactEmail && (
          <Typography variant="body2" color="text.secondary">
            {request.contactEmail}
          </Typography>
        )}

        <Stack spacing={2} sx={{ mt: 2.5 }}>
          <PanelCard
            title="Request Information"
            action={
              closed ? (
                <Typography variant="caption" color="text.secondary">
                  Closed {formatShortDate(request.closedAt)}
                </Typography>
              ) : (
                <Button
                  size="small"
                  startIcon={<EditOutlinedIcon />}
                  onClick={() => onEdit(request)}
                >
                  Edit
                </Button>
              )
            }
          >
            <TextField label="Issue" value={request.issue} />
            <TextField
              label="Service classification"
              value={requestTypeLabels[request.type]}
            />
            <Field label="Priority">
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ color: priority.color }}
              >
                {priority.label}
              </Typography>
            </Field>
            <Field label="Status">
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Pill label={status.label} color={status.color} />
                {request.statusNote && (
                  <Typography variant="body2" color="text.secondary">
                    {request.statusNote}
                  </Typography>
                )}
              </Stack>
            </Field>
          </PanelCard>

          <PanelCard title="Appointment">
            <TextField
              label="State"
              value={appointmentStateLabels[request.appointmentState]}
            />
            {(hasVisit || isOverdue) && (
              <TextField
                label={isOverdue ? 'Was due on' : 'Date'}
                value={formatLongDate(request.appointmentDate)}
              />
            )}
            {hasVisit && (
              <>
                <TextField
                  label="Arrival window"
                  value={`${formatTime(request.appointmentStart)} – ${formatTime(request.appointmentEnd)}`}
                />
                <TextField label="Technician" value={technician} />
              </>
            )}
            <TextField label="Access notes" value={request.notes} />
            {!closed && (
              <Button
                variant="outlined"
                size="small"
                onClick={() => onEdit(request)}
                sx={{ alignSelf: 'flex-start' }}
              >
                {request.appointmentState === 'NOT_SCHEDULED'
                  ? 'Schedule appointment'
                  : 'Reschedule appointment'}
              </Button>
            )}
          </PanelCard>
        </Stack>
      </Box>
    </Box>
  )
}
