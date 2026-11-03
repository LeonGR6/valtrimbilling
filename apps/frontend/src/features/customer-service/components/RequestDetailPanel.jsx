import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ForwardToInboxRoundedIcon from '@mui/icons-material/ForwardToInboxRounded'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import PhoneRoundedIcon from '@mui/icons-material/PhoneRounded'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined'
import { formatPhoneNumber } from '../../../utils/phoneNumbers.js'
import { prioritiesByValue } from '../data/customerService.js'
import {
  customerServiceTimeZone,
  formatLongDate,
  formatShortDate,
  formatTime,
} from '../utils/dates.js'
import { getPrototypeServiceTask } from '../utils/newRequestPrototype.js'
import {
  requestLocationLabel,
  requestPropertyLabel,
  requestWorkflowStages,
} from '../utils/requestInbox.js'
import Pill from './Pill.jsx'

function Field({ label, children }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        sx={{ mb: 0.25 }}
      >
        {label}
      </Typography>
      {children}
    </Box>
  )
}

function TextValue({ label, value, empty = '—' }) {
  return (
    <Field label={label}>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
        {value || empty}
      </Typography>
    </Field>
  )
}

function PanelCard({ title, action, children, sx }) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        bgcolor: 'background.paper',
        ...sx,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}
      >
        <Typography variant="subtitle2" fontWeight={800}>
          {title}
        </Typography>
        {action}
      </Stack>
      <Stack spacing={1.25}>{children}</Stack>
    </Box>
  )
}

function windowLabel(window) {
  if (!window) return ''
  return `${formatLongDate(window.date)} · ${formatTime(window.start)}–${formatTime(window.end)}`
}

function internalSlotLabel(slot) {
  if (!slot) return ''
  return `${formatTime(slot.start)}–${formatTime(slot.end)}`
}

function receivedAtLabel(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const reportedAtSourceLabels = {
  EMAIL_SENT: 'Original email date',
  ORDER_DATE: 'PDF Order Date',
  SCHEDULED_DATE: 'Source Scheduled Date',
  MANUAL: 'Manual or default',
}

function createdAtLabel(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', {
    timeZone: customerServiceTimeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export default function RequestDetailPanel({
  request,
  onClose,
  onEdit,
  onViewPdf,
  onPrototypeAction,
  fullView = false,
}) {
  const stage = requestWorkflowStages[request.workflowStage]
  const priority = prioritiesByValue[request.priority]
  const hasCoordinates = Number.isFinite(request.latitude) && Number.isFinite(request.longitude)
  const coordinates = hasCoordinates
    ? `${request.latitude.toFixed(6)}, ${request.longitude.toFixed(6)}`
    : ''
  const sourceEmail = request.sourceEmail ?? {
    from: '',
    subject: '',
    receivedAt: '',
    body: '',
    attachmentCount: 0,
    attachmentNames: [],
  }
  const serviceTask = getPrototypeServiceTask(request.serviceTask)
  const requestedWorkItems = Array.isArray(request.requestedWorkItems)
    ? request.requestedWorkItems
    : []

  return (
    <Box
      sx={{
        bgcolor: 'background.default',
        border: fullView ? 0 : 1,
        borderColor: 'divider',
        borderRadius: fullView ? 0 : 2,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          p: 2.5,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          position: fullView ? 'sticky' : 'static',
          top: 0,
          zIndex: fullView ? 2 : 'auto',
        }}
      >
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
              useFlexGap
              sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}
            >
              <Typography variant="h6" fontWeight={800}>
                {request.requestNumber}
              </Typography>
              <Pill label={stage.label} color={stage.color} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {requestLocationLabel(request)}
            </Typography>
          </Box>
          <IconButton size="small" aria-label="Close details" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack spacing={1} sx={{ mt: 2 }}>
          <Button
            fullWidth
            variant="contained"
            color={stage.color === 'neutral' ? 'primary' : stage.color}
            startIcon={<AutoAwesomeRoundedIcon />}
            onClick={() => onPrototypeAction(stage.nextAction)}
            sx={{ justifyContent: 'flex-start' }}
          >
            {stage.nextAction}
          </Button>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<EditOutlinedIcon />}
            onClick={() => onEdit(request)}
            sx={{ justifyContent: 'flex-start' }}
          >
            Edit request
          </Button>
        </Stack>

        {(request.contactPhone || request.contactEmail) && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
            {request.contactPhone && (
              <>
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
              </>
            )}
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
        )}

        <Stack direction="row" spacing={3} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
          <TextValue label="Reported" value={formatShortDate(request.reportedAt)} />
          <TextValue
            label="Reported source"
            value={reportedAtSourceLabels[request.reportedAtSource]}
            empty="Not recorded"
          />
          <TextValue
            label="Created"
            value={createdAtLabel(request.createdAt)}
            empty="Not recorded"
          />
          <TextValue label="Due" value={formatShortDate(request.dueOn)} />
          <Field label="Priority">
            <Typography variant="body2" fontWeight={800} sx={{ color: priority.color }}>
              {priority.label}
            </Typography>
          </Field>
          <TextValue label="Coordinator" value={request.coordinatorName} empty="Not assigned" />
        </Stack>
      </Box>

      <Box
        sx={{
          p: 2.5,
          display: fullView ? 'grid' : 'flex',
          flexDirection: 'column',
          gridTemplateColumns: fullView
            ? { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }
            : undefined,
          gap: 2,
        }}
      >
        <PanelCard title="Customer & property">
          <TextValue label="Customer" value={request.contactName} />
          <TextValue label="Phone" value={formatPhoneNumber(request.contactPhone)} />
          <TextValue label="Email" value={request.contactEmail} />
          {request.additionalContacts?.map((contact, index) => (
            <Box key={`${contact.email}-${contact.phone}`}>
              <Divider />
              <TextValue label={`Additional customer ${index + 1}`} value={contact.name} />
              <TextValue label="Phone" value={formatPhoneNumber(contact.phone)} />
              <TextValue label="Email" value={contact.email} />
            </Box>
          ))}
          <Divider />
          <TextValue
            label="Property"
            value={requestPropertyLabel(request)}
          />
          <TextValue label="Address" value={request.address} empty="Not provided" />
          <TextValue label="Coordinates" value={coordinates} empty="Not provided" />
          {hasCoordinates && (
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
              Open in Maps
            </Button>
          )}
        </PanelCard>

        <PanelCard title="Service request">
          <TextValue label="Service type" value={request.serviceKind} />
          <TextValue label="Work category" value={request.workType} />
          {request.serviceTask && (
            <TextValue label="Service task" value={serviceTask?.label ?? request.serviceTask} />
          )}
          {requestedWorkItems.length === 0 && (request.description || request.issue) && (
            <TextValue label="Requested work" value={request.description || request.issue} />
          )}
          <TextValue
            label="Estimated duration"
            value={request.estimatedDurationMinutes
              ? `${request.estimatedDurationMinutes} minutes`
              : ''}
            empty="Not provided"
          />
          {request.crewSize && (
            <TextValue
              label="Crew required"
              value={`${request.crewSize} ${request.crewSize === 1 ? 'person' : 'people'}`}
            />
          )}
          {request.internalNotes && (
            <TextValue label="Internal notes" value={request.internalNotes} />
          )}
        </PanelCard>

        {requestedWorkItems.length > 0 && (
          <PanelCard
            title={`Requested work items (${requestedWorkItems.length})`}
            sx={{ gridColumn: fullView ? '1 / -1' : undefined }}
          >
            {requestedWorkItems.map((item, index) => (
              <Box
                key={item.id ?? `${item.itemNumber}-${index}`}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  p: 1.5,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  Item {item.itemNumber || index + 1}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: 'pre-wrap' }}>
                  {item.description || 'No description provided'}
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.75}
                  useFlexGap
                  sx={{ mt: 1, flexWrap: 'wrap' }}
                >
                  <Chip
                    size="small"
                    label={item.materialRequired ? 'Material required' : 'No material marked'}
                    color={item.materialRequired ? 'warning' : 'default'}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={item.chargeable ? 'Chargeable' : 'Not chargeable'}
                    color={item.chargeable ? 'info' : 'default'}
                    variant="outlined"
                  />
                </Stack>
              </Box>
            ))}
          </PanelCard>
        )}

        <PanelCard title="Scheduling">
          <TextValue
            label="Two-hour appointment block"
            value={windowLabel(request.customerWindow)}
            empty="Not proposed"
          />
          <TextValue
            label="Internal work slot"
            value={internalSlotLabel(request.internalSlot)}
            empty="Not planned"
          />
          <TextValue label="Technician" value={request.technicianName} empty="Not assigned" />
          <TextValue label="Customer confirmation" value={request.confirmationStatus} />
          <Divider />
          <TextValue
            label="Unavailable days"
            value={request.customerUnavailableDates.length
              ? request.customerUnavailableDates.map(formatLongDate).join(', ')
              : 'None'}
          />
          <TextValue
            label="Contact requested"
            value={request.customerNeedsContact ? 'Yes' : 'No'}
          />
          <TextValue
            label="Additional comments"
            value={request.customerAvailabilityNotes}
          />
        </PanelCard>

        <PanelCard
          title="Original service email"
          action={(
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {sourceEmail.pinned && (
                <Chip
                  size="small"
                  icon={<PushPinRoundedIcon />}
                  label="Pinned"
                  color="primary"
                  variant="outlined"
                />
              )}
              {sourceEmail.attachmentCount > 0 && onViewPdf && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AttachFileRoundedIcon />}
                  onClick={() => onViewPdf(request)}
                >
                  View PDF
                </Button>
              )}
            </Stack>
          )}
        >
          <TextValue label="From" value={sourceEmail.from} />
          <TextValue label="Subject" value={sourceEmail.subject} />
          <TextValue
            label="Received"
            value={receivedAtLabel(sourceEmail.receivedAt)}
          />
          {sourceEmail.body && (
            <TextValue label="Original content" value={sourceEmail.body} />
          )}
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip
              size="small"
              icon={<AttachFileRoundedIcon />}
              label={`${sourceEmail.attachmentCount} attachment${sourceEmail.attachmentCount === 1 ? '' : 's'}`}
              variant="outlined"
            />
            <Chip
              size="small"
              icon={<ForwardToInboxRoundedIcon />}
              label={sourceEmail.forwardedToCrew ? 'Sent to crew' : 'Not sent to crew'}
              color={sourceEmail.forwardedToCrew ? 'success' : 'default'}
              variant="outlined"
            />
          </Stack>
          {sourceEmail.attachmentNames?.length > 0 && (
            <Stack spacing={0.75}>
              <Typography variant="caption" color="text.secondary">
                Attachments
              </Typography>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {sourceEmail.attachmentNames.map((name) => (
                  <Chip
                    key={name}
                    size="small"
                    icon={<AttachFileRoundedIcon />}
                    label={name}
                    variant="outlined"
                    sx={{ maxWidth: '100%' }}
                  />
                ))}
              </Stack>
            </Stack>
          )}
        </PanelCard>

        <PanelCard title="Activity">
          {request.activity.map((item, index) => (
            <Stack key={item.id} direction="row" spacing={1.25}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  mt: 0.75,
                  borderRadius: '50%',
                  bgcolor: index === 0
                    ? stage.color === 'neutral' ? 'text.disabled' : `${stage.color}.main`
                    : 'divider',
                  flexShrink: 0,
                }}
              />
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {item.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {item.detail}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {formatLongDate(item.at)}
                </Typography>
              </Box>
            </Stack>
          ))}
        </PanelCard>
      </Box>
    </Box>
  )
}
