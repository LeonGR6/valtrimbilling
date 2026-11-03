import { useMemo, useState } from 'react'
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
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AltRouteRoundedIcon from '@mui/icons-material/AltRouteRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import EditCalendarOutlinedIcon from '@mui/icons-material/EditCalendarOutlined'
import {
  toZonedDateTimeInput,
} from '../services/customerServiceRecord.js'
import {
  adjustedStopEndInput,
  buildProposalAdjustments,
  groupServiceScheduleProposals,
} from '../utils/routePlanner.js'
import { formatLongDate } from '../utils/dates.js'

function formatDateTime(value, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function ApprovalDialog({
  proposal,
  settings,
  initialManualAdjustment,
  saving,
  onClose,
  onApprove,
}) {
  const [manualAdjustment, setManualAdjustment] = useState(
    initialManualAdjustment,
  )
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [startsByRequest, setStartsByRequest] = useState(() => (
    Object.fromEntries(proposal.stops.map((stop) => [
      stop.requestId,
      toZonedDateTimeInput(stop.startsAt, settings.timeZone),
    ]))
  ))

  const submit = () => {
    const adjustments = manualAdjustment
      ? buildProposalAdjustments(
        proposal,
        startsByRequest,
        settings.timeZone,
      )
      : []

    if (manualAdjustment && adjustments.length === 0) {
      setError('Change at least one arrival time or approve the generated route as-is.')
      return
    }
    if (manualAdjustment && !reason.trim()) {
      setError('Enter the administrative reason for changing the generated route.')
      return
    }

    setError('')
    onApprove(proposal, adjustments, manualAdjustment ? reason.trim() : '')
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        Approve {proposal.rank === 1 ? 'primary route' : `alternative ${proposal.rank}`}
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          This creates the appointments as Not sent. No customer email is sent in Phase 1C.
        </Alert>

        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>
              {proposal.technicianName} · {formatLongDate(proposal.proposedOn)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {proposal.stops.length} stop{proposal.stops.length === 1 ? '' : 's'} ·{' '}
              {proposal.totalDistanceMiles.toFixed(1)} miles
            </Typography>
          </Box>

          <FormControlLabel
            control={(
              <Switch
                checked={manualAdjustment}
                onChange={(event) => {
                  setManualAdjustment(event.target.checked)
                  setError('')
                }}
              />
            )}
            label="Exceptionally adjust arrival times"
          />

          {proposal.stops.map((stop) => (
            <Box key={stop.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
              <Typography variant="body2" fontWeight={700}>
                {stop.stopOrder}. {stop.folio} · {stop.address}
              </Typography>
              {manualAdjustment ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1.25 }}>
                  <TextField
                    fullWidth
                    size="small"
                    type="datetime-local"
                    label="Arrival"
                    value={startsByRequest[stop.requestId] ?? ''}
                    onChange={(event) => setStartsByRequest((current) => ({
                      ...current,
                      [stop.requestId]: event.target.value,
                    }))}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label="Ends"
                    value={adjustedStopEndInput(
                      stop,
                      startsByRequest[stop.requestId],
                      settings.timeZone,
                    ).replace('T', ' ')}
                    slotProps={{ input: { readOnly: true } }}
                  />
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {formatDateTime(stop.startsAt, settings.timeZone)}–
                  {formatDateTime(stop.endsAt, settings.timeZone)}
                </Typography>
              )}
            </Box>
          ))}

          {manualAdjustment && (
            <TextField
              required
              multiline
              minRows={2}
              label="Administrative reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setError('')
              }}
              inputProps={{ maxLength: 500 }}
              helperText={`${reason.length}/500 · Stored with the proposal and adjusted appointments.`}
            />
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={<CheckCircleOutlineRoundedIcon />}
          onClick={submit}
          disabled={saving}
        >
          {saving ? 'Approving…' : 'Approve route'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ProposalCard({
  proposal,
  settings,
  canManage,
  busy,
  onOpenApproval,
  onRecalculate,
}) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: proposal.rank === 1 ? 'primary.main' : 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        p: 2,
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
      >
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={750}>
              {proposal.rank === 1 ? 'Primary proposal' : `Alternative ${proposal.rank}`}
            </Typography>
            <Chip
              size="small"
              color={proposal.rank === 1 ? 'primary' : 'default'}
              label={`Score ${proposal.score.toFixed(0)}`}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {proposal.totalDistanceMiles.toFixed(1)} mi · {proposal.workMinutes} min work ·{' '}
            {proposal.travelBufferMinutes} min travel buffer ·{' '}
            {proposal.remainingWorkMinutes} min capacity left
          </Typography>
        </Box>

        {canManage && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleOutlineRoundedIcon />}
              disabled={busy}
              onClick={() => onOpenApproval(proposal, false)}
            >
              Approve
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditCalendarOutlinedIcon />}
              disabled={busy}
              onClick={() => onOpenApproval(proposal, true)}
            >
              Adjust & approve
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<AutoAwesomeRoundedIcon />}
              disabled={busy}
              onClick={() => onRecalculate(proposal.requestedForRequestId)}
            >
              Recalculate
            </Button>
          </Stack>
        )}
      </Stack>

      <Divider sx={{ my: 1.75 }} />

      <Stack spacing={1.5}>
        {proposal.stops.map((stop) => (
          <Stack key={stop.id} direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Chip size="small" label={stop.stopOrder} color="primary" variant="outlined" />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={700}>
                {stop.folio} · {stop.address}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatDateTime(stop.startsAt, settings.timeZone)}–
                {formatDateTime(stop.endsAt, settings.timeZone)} ·{' '}
                {stop.distanceFromPreviousMiles.toFixed(1)} mi from previous point
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>

      {(proposal.reasons.length > 0 || proposal.warnings.length > 0) && (
        <Box sx={{ mt: 1.75 }}>
          {proposal.reasons.map((reason) => (
            <Typography key={reason} variant="caption" color="success.main" display="block">
              • {reason}
            </Typography>
          ))}
          {proposal.warnings.map((warning) => (
            <Typography key={warning} variant="caption" color="warning.main" display="block">
              • {warning}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  )
}

export default function RoutePlanner({
  proposals,
  settings,
  canManage,
  busyProposalId,
  recalculatingRequestId,
  onApprove,
  onRecalculate,
}) {
  const groups = useMemo(
    () => groupServiceScheduleProposals(proposals),
    [proposals],
  )
  const [approval, setApproval] = useState(null)

  if (!groups.length) {
    return (
      <Box
        sx={{
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          p: 5,
          textAlign: 'center',
        }}
      >
        <AltRouteRoundedIcon color="disabled" sx={{ fontSize: 48 }} />
        <Typography variant="h6" fontWeight={700} sx={{ mt: 1 }}>
          No routes are waiting for approval
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Generate automatic proposals from a ready Customer Service request.
        </Typography>
      </Box>
    )
  }

  return (
    <Stack spacing={3}>
      {groups.map((dateGroup) => (
        <Box key={dateGroup.date}>
          <Typography variant="h6" fontWeight={750} sx={{ mb: 1.5 }}>
            {formatLongDate(dateGroup.date)}
          </Typography>
          <Stack spacing={2}>
            {dateGroup.technicians.map((technician) => (
              <Box
                key={technician.technicianId}
                sx={{
                  bgcolor: 'sidebar.bg',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  p: { xs: 1.5, md: 2 },
                }}
              >
                <Typography variant="subtitle1" fontWeight={750} sx={{ mb: 1.5 }}>
                  {technician.technicianName}
                </Typography>
                <Stack spacing={1.5}>
                  {technician.proposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      settings={settings}
                      canManage={canManage}
                      busy={busyProposalId === proposal.id
                        || recalculatingRequestId === proposal.requestedForRequestId}
                      onOpenApproval={(selected, manual) => setApproval({
                        proposal: selected,
                        manual,
                      })}
                      onRecalculate={onRecalculate}
                    />
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      ))}

      {approval && (
        <ApprovalDialog
          key={`${approval.proposal.id}-${approval.manual}`}
          proposal={approval.proposal}
          settings={settings}
          initialManualAdjustment={approval.manual}
          saving={busyProposalId === approval.proposal.id}
          onClose={() => setApproval(null)}
          onApprove={async (...args) => {
            const approved = await onApprove(...args)
            if (approved) setApproval(null)
          }}
        />
      )}
    </Stack>
  )
}
