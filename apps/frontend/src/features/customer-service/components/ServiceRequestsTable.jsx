import { alpha } from '@mui/material/styles'
import {
  Box,
  Button,
  ButtonGroup,
  IconButton,
  Pagination,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined'
import { formatPhoneNumber } from '../../../utils/phoneNumbers.js'
import {
  builderLabelsById,
  coordinatorLabelsById,
  isClosed,
  prioritiesByValue,
  requestTagsByValue,
  statusesByValue,
  technicianLabelsById,
} from '../data/customerService.js'

import Pill from './Pill.jsx'
import { formatLongDate, formatShortDate, formatTime } from '../utils/dates.js'

function MutedLine({ children }) {
  return (
    <Typography variant="caption" color="text.secondary" display="block">
      {children}
    </Typography>
  )
}

// Quick contact actions. They hand off to the device rather than pretending to
// send anything from the app.
function ContactAction({ title, href, color, icon: Icon }) {
  return (
    <Tooltip title={title}>
      <IconButton
        component="a"
        href={href}
        aria-label={title}
        size="small"
        onClick={(event) => event.stopPropagation()}
        sx={(theme) => ({
          width: 26,
          height: 26,
          borderRadius: '4px',
          color: `${color}.main`,
          bgcolor: alpha(theme.palette[color].main, 0.16),
          '&:hover': { bgcolor: alpha(theme.palette[color].main, 0.28) },
        })}
      >
        <Icon sx={{ fontSize: 15 }} />
      </IconButton>
    </Tooltip>
  )
}

function AppointmentCell({ request, onSchedule }) {
  const technician = technicianLabelsById[request.technicianId]
  // A closed request is frozen, so it stops offering to book anything.
  const locked = isClosed(request)

  if (request.appointmentState === 'NOT_SCHEDULED') {
    return (
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <EventBusyOutlinedIcon
            sx={{ fontSize: 16, color: 'text.disabled' }}
          />
          <Typography variant="body2" color="text.secondary">
            Not scheduled
          </Typography>
        </Stack>
        {!locked && (
          <Button
            size="small"
            variant="outlined"
            onClick={(event) => {
              event.stopPropagation()
              onSchedule(request)
            }}
          >
            Schedule
          </Button>
        )}
      </Stack>
    )
  }

  if (request.appointmentState === 'OVERDUE') {
    return (
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: 'error.main' }} />
          <Typography variant="body2" color="error.main">
            Overdue
          </Typography>
        </Stack>
        <MutedLine>
          Was due {formatShortDate(request.appointmentDate)}
        </MutedLine>
        {!locked && (
          <Button
            size="small"
            variant="outlined"
            onClick={(event) => {
              event.stopPropagation()
              onSchedule(request)
            }}
          >
            Schedule
          </Button>
        )}
      </Stack>
    )
  }

  const completed = request.appointmentState === 'COMPLETED'

  return (
    <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        {completed ? (
          <CheckCircleOutlineRoundedIcon
            sx={{ fontSize: 16, color: 'success.main' }}
          />
        ) : (
          <EventOutlinedIcon sx={{ fontSize: 16, color: 'primary.main' }} />
        )}
        <Typography
          variant="body2"
          color={completed ? 'success.main' : 'text.primary'}
        >
          {completed ? 'Completed' : formatLongDate(request.appointmentDate)}
        </Typography>
      </Stack>
      <MutedLine>
        {completed
          ? formatShortDate(request.appointmentDate)
          : `${formatTime(request.appointmentStart)} – ${formatTime(request.appointmentEnd)}`}
      </MutedLine>
      {technician && <MutedLine>{technician}</MutedLine>}
    </Stack>
  )
}

const columns = [
  'Request',
  'Property',
  'Contact',
  'Issue',
  'Appointment',
  'Status',
  'Priority',
  'Action',
]

export default function ServiceRequestsTable({
  requests,
  totalCount,
  page,
  rowsPerPage,
  selectedId,
  onSelect,
  onOpen,
  onSchedule,
  onMenuOpen,
  onPageChange,
}) {
  const pageCount = Math.max(1, Math.ceil(totalCount / rowsPerPage))
  const firstRow = totalCount === 0 ? 0 : page * rowsPerPage + 1
  const lastRow = Math.min(totalCount, page * rowsPerPage + requests.length)

  return (
    <>
      <TableContainer>
        <Table sx={{ minWidth: 1180 }}>
          <TableHead>
            <TableRow
              sx={{
                bgcolor: 'sidebar.bg',
                '& .MuiTableCell-root': {
                  color: 'text.secondary',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                },
              }}
            >
              {columns.map((column) => (
                <TableCell key={column}>{column}</TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {requests.map((request) => {
              const tag = requestTagsByValue[request.tag]
              const status = statusesByValue[request.status]
              const priority = prioritiesByValue[request.priority]
              const isSelected = request.id === selectedId

              return (
                <TableRow
                  key={request.id}
                  hover
                  selected={isSelected}
                  onClick={() => onSelect(request.id)}
                  sx={{
                    cursor: 'pointer',
                    '& .MuiTableCell-root': {
                      verticalAlign: 'top',
                      py: 1.75,
                    },
                    // Transparent when idle so selecting a row never shifts
                    // the columns sideways.
                    '& .MuiTableCell-root:first-of-type': {
                      borderLeft: '3px solid',
                      borderLeftColor: isSelected
                        ? 'primary.main'
                        : 'transparent',
                    },
                    '&:last-child .MuiTableCell-root': { borderBottom: 0 },
                  }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {request.requestNumber}
                    </Typography>
                    {tag && (
                      <Box sx={{ mt: 0.5 }}>
                        <Pill dense label={tag.label} color={tag.color} />
                      </Box>
                    )}
                    <Box sx={{ mt: 0.5 }}>
                      <MutedLine>
                        {formatShortDate(request.reportedAt)}
                      </MutedLine>
                      <MutedLine>
                        By: {coordinatorLabelsById[request.createdById] ?? '—'}
                      </MutedLine>
                    </Box>
                  </TableCell>

                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {builderLabelsById[request.builder] ?? request.builder} ·{' '}
                      {request.community} · Lot {request.lotNumber}
                    </Typography>
                    <Box sx={{ mt: 0.25 }}>
                      <MutedLine>{request.street}</MutedLine>
                      <MutedLine>
                        {request.city}, {request.state} {request.postalCode}
                      </MutedLine>
                      {request.plan && <MutedLine>{request.plan}</MutedLine>}
                    </Box>
                  </TableCell>

                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {request.contactName}
                    </Typography>
                    <Box sx={{ mt: 0.25 }}>
                      <MutedLine>
                        {formatPhoneNumber(request.contactPhone)}
                      </MutedLine>
                      {request.contactEmail && (
                        <MutedLine>{request.contactEmail}</MutedLine>
                      )}
                    </Box>
                    <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
                      <ContactAction
                        title={`Text ${request.contactName}`}
                        href={`sms:${request.contactPhone}`}
                        color="success"
                        icon={SmsOutlinedIcon}
                      />
                      {request.contactEmail && (
                        <ContactAction
                          title={`Email ${request.contactName}`}
                          href={`mailto:${request.contactEmail}`}
                          color="primary"
                          icon={EmailOutlinedIcon}
                        />
                      )}
                    </Stack>
                  </TableCell>

                  <TableCell sx={{ maxWidth: 180 }}>
                    <Typography variant="body2">{request.issue}</Typography>
                  </TableCell>

                  <TableCell sx={{ minWidth: 170 }}>
                    <AppointmentCell
                      request={request}
                      onSchedule={onSchedule}
                    />
                  </TableCell>

                  <TableCell>
                    <Pill label={status.label} color={status.color} />
                    {request.statusNote && (
                      <Box sx={{ mt: 0.5 }}>
                        <MutedLine>{request.statusNote}</MutedLine>
                      </Box>
                    )}
                  </TableCell>

                  <TableCell>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ color: priority.color }}
                    >
                      {priority.label}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <ButtonGroup
                      variant="contained"
                      size="small"
                      disableElevation
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button onClick={() => onOpen(request)}>View</Button>
                      <Button
                        aria-label={`More actions for ${request.requestNumber}`}
                        onClick={(event) => onMenuOpen(event, request)}
                        sx={{ px: 0.5, minWidth: 32 }}
                      >
                        <KeyboardArrowDownRoundedIcon fontSize="small" />
                      </Button>
                    </ButtonGroup>
                  </TableCell>
                </TableRow>
              )
            })}

            {requests.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  sx={{ py: 8, textAlign: 'center' }}
                >
                  <SearchRoundedIcon
                    color="action"
                    sx={{ fontSize: 40, mb: 1 }}
                  />
                  <Typography fontWeight={600}>No requests found</Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    Try changing your search or filters.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          py: 1.75,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Showing {firstRow} to {lastRow} of {totalCount} requests
        </Typography>
        <Pagination
          count={pageCount}
          page={page + 1}
          onChange={(_, nextPage) => onPageChange(nextPage - 1)}
          size="small"
          shape="rounded"
        />
      </Stack>
    </>
  )
}
