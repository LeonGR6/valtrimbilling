import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { formatPhoneNumber } from '../../../utils/phoneNumbers.js'
import { prioritiesByValue } from '../data/customerService.js'
import { formatLongDate, formatTime } from '../utils/dates.js'
import {
  effectiveRequestWorkflowStage,
  inboxPageSizeOptions,
  isRequestOverdue,
  requestLocationLabel,
  requestWorkflowStages,
} from '../utils/requestInbox.js'
import Pill from './Pill.jsx'

function customerWindowLabel(window) {
  if (!window) return ''
  return `${formatLongDate(window.date)} · ${formatTime(window.start)}–${formatTime(window.end)}`
}

function hasSourcePdf(request) {
  const sourceEmail = request.sourceEmail ?? {}
  return Number(sourceEmail.attachmentCount) > 0
    || sourceEmail.attachmentNames?.some((name) => name.toLowerCase().endsWith('.pdf'))
}

function workSummary(request) {
  const itemCount = request.requestedWorkItems?.length ?? 0
  const details = [
    itemCount > 0 ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : null,
    request.estimatedDurationMinutes ? `${request.estimatedDurationMinutes} min` : null,
    request.crewSize ? `${request.crewSize} ${request.crewSize === 1 ? 'person' : 'people'}` : null,
  ].filter(Boolean)

  return details.join(' · ')
}

function RequestActions({ request, onView, onEdit, onViewPdf, onOpenProposal, compact = false }) {
  const pdfAvailable = hasSourcePdf(request)
  const needsReview = effectiveRequestWorkflowStage(request) === 'NEEDS_REVIEW'
  const opensProposal = effectiveRequestWorkflowStage(request) === 'READY_TO_PROPOSE'
    && Boolean(onOpenProposal)

  return (
    <Stack
      direction="row"
      spacing={0.75}
      useFlexGap
      sx={{ flexWrap: 'wrap', justifyContent: compact ? 'flex-start' : 'flex-end' }}
    >
      <Button
        size="small"
        variant="contained"
        startIcon={<VisibilityOutlinedIcon />}
        onClick={() => opensProposal ? onOpenProposal(request) : onView(request)}
      >
        {opensProposal ? 'Open Proposal Workspace' : needsReview ? 'Review request' : 'View'}
      </Button>
      {opensProposal && (
        <Button size="small" variant="outlined" onClick={() => onView(request)}>View</Button>
      )}
      {onEdit && <Button
        size="small"
        variant="outlined"
        startIcon={<EditOutlinedIcon />}
        onClick={() => onEdit(request)}
      >
        Edit
      </Button>}
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        startIcon={<PictureAsPdfRoundedIcon />}
        disabled={!pdfAvailable}
        onClick={() => onViewPdf(request)}
      >
        PDF
      </Button>
    </Stack>
  )
}

function DesktopRequestTable({ requests, onView, onEdit, onViewPdf, onOpenProposal }) {
  return (
    <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
      <Table aria-label="Customer Service requests">
        <TableHead>
          <TableRow>
            <TableCell>Request</TableCell>
            <TableCell>Property</TableCell>
            <TableCell>Customer</TableCell>
            <TableCell>Work</TableCell>
            <TableCell>Planning</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {requests.map((request) => {
            const stage = requestWorkflowStages[effectiveRequestWorkflowStage(request)]
            const priority = prioritiesByValue[request.priority]

            return (
              <TableRow key={request.id} hover>
                <TableCell sx={{ minWidth: 150, verticalAlign: 'top' }}>
                  <Typography variant="body2" fontWeight={800}>
                    {request.requestNumber}
                  </Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                    <Pill dense label={stage.label} color={stage.color} />
                    {isRequestOverdue(request) && <Chip size="small" color="error" variant="outlined" label="Overdue" />}
                  </Stack>
                  <Typography
                    variant="caption"
                    fontWeight={700}
                    sx={{ display: 'block', mt: 0.75, color: priority.color }}
                  >
                    {priority.label} priority
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 190, maxWidth: 260, verticalAlign: 'top' }}>
                  <Typography variant="body2" fontWeight={700}>
                    {requestLocationLabel(request) || 'Location not provided'}
                  </Typography>
                  {request.builderName && (
                    <Typography variant="caption" color="text.secondary">
                      {request.builderName}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ minWidth: 180, verticalAlign: 'top' }}>
                  <Typography variant="body2" fontWeight={700}>
                    {request.contactName || 'Customer not provided'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {formatPhoneNumber(request.contactPhone) || 'No phone'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 220, maxWidth: 330, verticalAlign: 'top' }}>
                  <Typography variant="body2" fontWeight={700}>
                    {request.issue || request.description || 'Work not described'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[request.serviceKind, workSummary(request)].filter(Boolean).join(' · ')}
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 210, verticalAlign: 'top' }}>
                  <Typography variant="body2" fontWeight={700}>
                    {request.customerWindow
                      ? customerWindowLabel(request.customerWindow)
                      : stage.nextAction}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {request.dueOn ? `Due ${formatLongDate(request.dueOn)}` : 'Due date pending'}
                  </Typography>
                  {request.technicianName && (
                    <Typography variant="caption" color="text.secondary">
                      {request.technicianName}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right" sx={{ minWidth: 300, verticalAlign: 'top' }}>
                  <RequestActions
                    request={request}
                    onView={onView}
                    onEdit={onEdit}
                    onViewPdf={onViewPdf}
                    onOpenProposal={onOpenProposal}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function MobileRequestCards({ requests, onView, onEdit, onViewPdf, onOpenProposal }) {
  return (
    <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' }, p: 1.5 }}>
      {requests.map((request) => {
        const stage = requestWorkflowStages[effectiveRequestWorkflowStage(request)]
        const priority = prioritiesByValue[request.priority]

        return (
          <Card key={request.id} variant="outlined">
            <CardContent>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
              >
                <Typography fontWeight={800}>{request.requestNumber}</Typography>
                <Pill dense label={stage.label} color={stage.color} />
                {isRequestOverdue(request) && <Chip size="small" color="error" variant="outlined" label="Overdue" />}
              </Stack>
              <Typography variant="body2" fontWeight={700} sx={{ mt: 1.25 }}>
                {requestLocationLabel(request) || 'Location not provided'}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                {request.issue || request.description || 'Work not described'}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {[request.contactName, workSummary(request)].filter(Boolean).join(' · ')}
              </Typography>
              <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {request.dueOn ? `Due ${formatLongDate(request.dueOn)}` : 'Due date pending'}
                </Typography>
                <Typography variant="caption" fontWeight={700} sx={{ color: priority.color }}>
                  {priority.label} priority
                </Typography>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              <RequestActions
                request={request}
                onView={onView}
                onEdit={onEdit}
                onViewPdf={onViewPdf}
                onOpenProposal={onOpenProposal}
                compact
              />
            </CardContent>
          </Card>
        )
      })}
    </Stack>
  )
}

export default function RequestInboxList({
  requests,
  totalCount,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  onView,
  onEdit,
  onViewPdf,
  onOpenProposal,
}) {
  if (!totalCount) {
    return (
      <Stack sx={{ alignItems: 'center', py: 8, px: 3, textAlign: 'center' }}>
        <SearchRoundedIcon color="action" sx={{ fontSize: 42 }} />
        <Typography fontWeight={700} sx={{ mt: 1.25 }}>
          No requests found
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Create a new request, or try another search or filter.
        </Typography>
      </Stack>
    )
  }

  return (
    <Box>
      <DesktopRequestTable
        requests={requests}
        onView={onView}
        onEdit={onEdit}
        onViewPdf={onViewPdf}
        onOpenProposal={onOpenProposal}
      />
      <MobileRequestCards
        requests={requests}
        onView={onView}
        onEdit={onEdit}
        onViewPdf={onViewPdf}
        onOpenProposal={onOpenProposal}
      />
      <Divider />
      <TablePagination
        component="div"
        count={totalCount}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={inboxPageSizeOptions}
        onPageChange={(_, nextPage) => onPageChange(nextPage)}
        onRowsPerPageChange={(event) => onRowsPerPageChange(Number(event.target.value))}
        labelRowsPerPage="Requests per page"
      />
    </Box>
  )
}
