import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded'
import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded'
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import {
  getBuilderFollowUpEscalationSettings,
  getBuilderFollowUpEmailMode,
  listBuilderFollowUpAttention,
  listBuilderFollowUpResponses,
  listBuilderFollowUpRescheduleRequests,
  listBuilderFollowUps,
  previewBuilderFollowUpEscalation,
  previewBuilderFollowUpEmail,
  recordBuilderFollowUpStatus,
  refreshBuilderFollowUps,
  resolveBuilderFollowUpRescheduleRequest,
  saveBuilderFollowUpEscalationSettings,
  sendBuilderFollowUpEscalation,
  sendBuilderFollowUpEmail,
  sendDueBuilderFollowUpEmails,
} from '../services/builderFollowUpRepository.js'
import {
  followUpDeliveryLabel,
  followUpEscalationLabel,
  followUpLotsLabel,
} from '../services/builderFollowUpRecord.js'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T12:00:00Z`))
}

function formatTimestamp(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : timestampFormatter.format(date)
}

function statusColor(status) {
  if (status === 'OVERDUE' || status === 'FAILED') return 'error'
  if (status === 'DUE') return 'warning'
  if (status === 'UPCOMING') return 'info'
  return 'default'
}

function escalationColor(status) {
  if (status === 'FAILED' || status === 'OVERDUE') return 'error'
  if (status === 'DUE' || status === 'PENDING') return 'warning'
  if (status === 'SENT') return 'success'
  if (status === 'PROCESSING') return 'info'
  return 'default'
}

export default function BuilderFollowUpQueue({ canManage = false, canConfigure = false }) {
  const [items, setItems] = useState([])
  const [attentionItems, setAttentionItems] = useState([])
  const [rescheduleItems, setRescheduleItems] = useState([])
  const [responseItems, setResponseItems] = useState([])
  const [settings, setSettings] = useState(null)
  const [mode, setMode] = useState('PREVIEW')
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reviewRequest, setReviewRequest] = useState(null)
  const [reviewDecision, setReviewDecision] = useState('APPROVED')
  const [reviewNote, setReviewNote] = useState('')
  const [settingsDraft, setSettingsDraft] = useState({
    isEnabled: true,
    waitBusinessDays: 2,
    recipientEmails: 'andres@valtrim.com',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (canManage) await refreshBuilderFollowUps()
      const [
        nextItems,
        nextAttentionItems,
        nextRescheduleItems,
        nextResponseItems,
        nextSettings,
        status,
      ] = await Promise.all([
        listBuilderFollowUps(),
        listBuilderFollowUpAttention(),
        listBuilderFollowUpRescheduleRequests(),
        listBuilderFollowUpResponses(),
        getBuilderFollowUpEscalationSettings(),
        canManage
          ? getBuilderFollowUpEmailMode()
          : Promise.resolve({ mode: 'PREVIEW' }),
      ])
      setItems(nextItems)
      setAttentionItems(nextAttentionItems)
      setRescheduleItems(nextRescheduleItems)
      setResponseItems(nextResponseItems)
      setSettings(nextSettings)
      setMode(status.mode)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [canManage])

  useEffect(() => {
    // Loading is synchronized to the authenticated session and tab lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => {})
  }, [load])

  const openPreview = async (item) => {
    setWorkingId(item.checkpointId)
    setError('')
    try {
      const result = await previewBuilderFollowUpEmail(item.checkpointId)
      setPreview(result)
    } catch (previewError) {
      setError(previewError.message)
    } finally {
      setWorkingId(null)
    }
  }

  const sendOne = async (item) => {
    setWorkingId(item.checkpointId)
    setError('')
    try {
      const result = await sendBuilderFollowUpEmail(item.checkpointId)
      if (result.preview) {
        setPreview(result)
      } else {
        setNotice(result.alreadySent
          ? 'This follow-up email had already been sent.'
          : `Follow-up email sent to ${item.recipientEmail}.`)
        await load()
      }
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setWorkingId(null)
    }
  }

  const openEscalationPreview = async (item) => {
    if (!item.escalationId) return
    setWorkingId(`escalation-${item.escalationId}`)
    setError('')
    try {
      const result = await previewBuilderFollowUpEscalation(item.escalationId)
      setPreview(result)
    } catch (previewError) {
      setError(previewError.message)
    } finally {
      setWorkingId(null)
    }
  }

  const sendEscalation = async (item) => {
    if (!item.escalationId) return
    setWorkingId(`escalation-${item.escalationId}`)
    setError('')
    try {
      const result = await sendBuilderFollowUpEscalation(item.escalationId)
      if (result.preview) {
        setPreview(result)
      } else {
        setNotice(result.alreadySent
          ? 'This internal no-response alert had already been sent.'
          : `Internal alert sent to ${item.recipientEmails.join(', ')}.`)
        await load()
      }
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setWorkingId(null)
    }
  }

  const recordStatus = async (item, status) => {
    setWorkingId(item.checkpointId)
    setError('')
    try {
      await recordBuilderFollowUpStatus(item.scheduleId, status)
      setNotice(status === 'CONFIRMED'
        ? `${item.stageType} marked confirmed for ${formatDate(item.workDate)}.`
        : 'No response recorded. Remaining checkpoints stay active.')
      await load()
    } catch (statusError) {
      setError(statusError.message)
    } finally {
      setWorkingId(null)
    }
  }

  const runDue = async () => {
    setWorkingId('batch')
    setError('')
    try {
      const result = await sendDueBuilderFollowUpEmails(25)
      setNotice(
        `Due email run finished: ${result.sent} sent, ${result.failed} failed `
        + `(${result.responseNotifications ?? 0} response confirmation${result.responseNotifications === 1 ? '' : 's'}, `
        + `${result.escalations ?? 0} internal alert${result.escalations === 1 ? '' : 's'} processed).`,
      )
      await load()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setWorkingId(null)
    }
  }

  const openRescheduleReview = (item, decision) => {
    setReviewRequest(item)
    setReviewDecision(decision)
    setReviewNote('')
  }

  const resolveReschedule = async () => {
    if (!reviewRequest) return
    setWorkingId(`request-${reviewRequest.requestId}`)
    setError('')
    try {
      await resolveBuilderFollowUpRescheduleRequest(
        reviewRequest.requestId,
        reviewDecision,
        reviewNote || null,
      )
      setReviewRequest(null)
      setNotice(reviewDecision === 'APPROVED'
        ? `${reviewRequest.stageType} moved to ${formatDate(reviewRequest.proposedWorkDate)}.`
        : 'The current date was kept and the follow-up was placed on hold for direct contact.')
      await load()
    } catch (reviewError) {
      setError(reviewError.message)
    } finally {
      setWorkingId(null)
    }
  }

  const openSettings = () => {
    setSettingsDraft({
      isEnabled: settings?.isEnabled ?? true,
      waitBusinessDays: settings?.waitBusinessDays ?? 2,
      recipientEmails: (settings?.recipientEmails ?? ['andres@valtrim.com']).join(', '),
    })
    setSettingsOpen(true)
  }

  const saveSettings = async () => {
    const recipientEmails = settingsDraft.recipientEmails
      .split(/[\n,;]/u)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
    setWorkingId('settings')
    setError('')
    try {
      await saveBuilderFollowUpEscalationSettings({
        isEnabled: settingsDraft.isEnabled,
        waitBusinessDays: Number(settingsDraft.waitBusinessDays),
        recipientEmails,
      })
      setSettingsOpen(false)
      setNotice('No-response escalation settings saved.')
      await load()
    } catch (settingsError) {
      setError(settingsError.message)
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <Box className="builder-follow-up-queue">
      <Box className="builder-follow-up-queue__toolbar">
        <Box>
          <Typography variant="h6" fontWeight={780}>Builder follow-up queue</Typography>
          <Typography color="text.secondary" variant="body2">
            {items.length} open checkpoint{items.length === 1 ? '' : 's'};{' '}
            {attentionItems.length + rescheduleItems.length}{' '}
            need{attentionItems.length + rescheduleItems.length === 1 ? 's' : ''} attention.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="flex-end">
          {canConfigure && (
            <Button
              variant="outlined"
              startIcon={<SettingsRoundedIcon />}
              onClick={openSettings}
              disabled={loading || Boolean(workingId)}
            >
              Escalation settings
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={load}
            disabled={loading || Boolean(workingId)}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<MarkEmailReadRoundedIcon />}
            onClick={runDue}
            disabled={
              !canManage
              || mode !== 'LIVE'
              || Boolean(workingId)
            }
          >
            Send due emails
          </Button>
        </Stack>
      </Box>

      {mode !== 'LIVE' && (
        <Alert severity="info">
          Preview mode is active. You can inspect every message, but no email can leave ValtrimBilling.
        </Alert>
      )}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}

      {!loading && responseItems.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'success.light' }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography fontWeight={780}>Recent Jobsite responses</Typography>
              <Typography variant="body2" color="text.secondary">
                Confirmations and date changes submitted from secure email links.
              </Typography>
            </Box>
            {responseItems.map((item) => {
              const rescheduled = item.responseAction === 'NOT_READY'
              const currentChangedAgain = item.currentWorkDate !== item.finalWorkDate
              return (
                <Paper key={item.responseEventId} variant="outlined" sx={{ p: 1.5 }}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: 'stretch', md: 'center' }}
                  >
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography fontWeight={760}>{item.stageType} · {item.jobCode}</Typography>
                        <Chip
                          size="small"
                          color={rescheduled ? 'warning' : 'success'}
                          label={rescheduled ? 'Rescheduled by Jobsite' : 'Confirmed'}
                        />
                      </Stack>
                      <Typography variant="body2">
                        {rescheduled
                          ? <>{formatDate(item.targetWorkDate)} → <strong>{formatDate(item.finalWorkDate)}</strong></>
                          : <>Confirmed for <strong>{formatDate(item.finalWorkDate)}</strong></>}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {item.superintendentName} · {item.superintendentEmail}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {formatTimestamp(item.respondedAt)} · {followUpLotsLabel(item)}
                        {item.reason ? ` · ${item.reason}` : ''}
                      </Typography>
                      {currentChangedAgain && (
                        <Typography variant="caption" color="warning.dark" display="block">
                          The Production date was changed again later; current date: {formatDate(item.currentWorkDate)}.
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        </Paper>
      )}

      {!loading && rescheduleItems.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'warning.light' }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <EventRepeatRoundedIcon color="warning" />
              <Box>
                <Typography fontWeight={780} color="warning.dark">
                  {rescheduleItems.length} requested date{rescheduleItems.length === 1 ? '' : 's'} to review
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Legacy requests created before automatic rescheduling still need a one-time review.
                </Typography>
              </Box>
            </Stack>
            {rescheduleItems.map((item) => {
              const requestWorking = workingId === `request-${item.requestId}`
              return (
                <Paper key={item.requestId} variant="outlined" sx={{ p: 1.5 }}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: 'stretch', md: 'center' }}
                  >
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography fontWeight={760}>{item.stageType} · {item.jobCode}</Typography>
                        <Chip size="small" color="warning" label="Date requested" />
                      </Stack>
                      <Typography variant="body2">
                        {formatDate(item.targetWorkDate)} → <strong>{formatDate(item.proposedWorkDate)}</strong>
                        {' '}({item.requestedShiftDays} day{item.requestedShiftDays === 1 ? '' : 's'} later)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {item.superintendentName} · {item.superintendentEmail}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {followUpLotsLabel(item)}{item.reason ? ` · ${item.reason}` : ''}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap">
                      <Button
                        size="small"
                        color="success"
                        variant="contained"
                        onClick={() => openRescheduleReview(item, 'APPROVED')}
                        disabled={!canManage || requestWorking}
                      >
                        Approve requested date
                      </Button>
                      <Button
                        size="small"
                        color="warning"
                        variant="outlined"
                        onClick={() => openRescheduleReview(item, 'REJECTED')}
                        disabled={!canManage || requestWorking}
                      >
                        Keep current / on hold
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        </Paper>
      )}

      {!loading && attentionItems.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'error.light' }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <ReportProblemRoundedIcon color="error" />
              <Box>
                <Typography fontWeight={780} color="error.main">
                  {attentionItems.length} Job{attentionItems.length === 1 ? '' : 's'} need attention
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  No response was recorded from the designated Jobsite Superintendent.
                </Typography>
              </Box>
            </Stack>
            {attentionItems.map((item) => {
              const escalationWorking = workingId === `escalation-${item.escalationId}`
              const canSendEscalation = canManage
                && mode === 'LIVE'
                && Boolean(item.escalationId)
                && ['DUE', 'OVERDUE', 'FAILED'].includes(item.deliveryStatus)
              return (
                <Paper key={item.noResponseEventId} variant="outlined" sx={{ p: 1.5 }}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: 'stretch', md: 'center' }}
                  >
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography fontWeight={760}>{item.stageType} · {item.jobCode}</Typography>
                        <Chip
                          size="small"
                          color={escalationColor(item.deliveryStatus)}
                          label={followUpEscalationLabel(item)}
                        />
                      </Stack>
                      <Typography variant="body2">
                        {item.superintendentName} · {item.superintendentEmail}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Work {formatDate(item.workDate)} · {followUpLotsLabel(item)} · Internal: {' '}
                        {item.recipientEmails.join(', ')}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap">
                      <Button
                        size="small"
                        startIcon={<VisibilityRoundedIcon />}
                        onClick={() => openEscalationPreview(item)}
                        disabled={!canManage || !item.escalationId || escalationWorking}
                      >
                        Preview alert
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        startIcon={<EmailRoundedIcon />}
                        onClick={() => sendEscalation(item)}
                        disabled={!canSendEscalation || escalationWorking}
                      >
                        Send internal alert
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        </Paper>
      )}

      {loading ? (
        <Box className="builder-follow-up-queue__loading"><CircularProgress size={30} /></Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" className="builder-follow-up-queue__empty">
          <CheckCircleRoundedIcon color="success" />
          <Typography fontWeight={720}>No open scheduled follow-up emails.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Builder follow-up queue">
            <TableHead>
              <TableRow>
                <TableCell>Due</TableCell>
                <TableCell>Work</TableCell>
                <TableCell>Job / Lots</TableCell>
                <TableCell>Jobsite Superintendent</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => {
                const isWorking = workingId === item.checkpointId
                const canSend = canManage
                  && mode === 'LIVE'
                  && ['DUE', 'OVERDUE', 'FAILED'].includes(item.deliveryStatus)
                  && item.recipientIsActive
                return (
                  <TableRow key={item.checkpointId} hover>
                    <TableCell>
                      <Stack spacing={0.5} alignItems="flex-start">
                        <Chip
                          size="small"
                          color={statusColor(item.deliveryStatus)}
                          label={followUpDeliveryLabel(item)}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(item.dueOn)} · {item.daysBefore} days
                        </Typography>
                        {item.followUpStatus === 'NO_RESPONSE' && (
                          <Chip size="small" color="error" label="No response" />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={760}>{item.stageType}</Typography>
                      <Typography variant="body2">{formatDate(item.workDate)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={720}>{item.jobCode}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {item.community} · {followUpLotsLabel(item)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography>{item.recipientName}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {item.recipientEmail}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.75} justifyContent="flex-end" flexWrap="wrap">
                        <Button
                          size="small"
                          startIcon={<VisibilityRoundedIcon />}
                          onClick={() => openPreview(item)}
                          disabled={!canManage || isWorking}
                        >
                          Preview
                        </Button>
                        <Button
                          size="small"
                          startIcon={<EmailRoundedIcon />}
                          onClick={() => sendOne(item)}
                          disabled={!canSend || isWorking}
                        >
                          Send
                        </Button>
                        <Button
                          size="small"
                          color="success"
                          onClick={() => recordStatus(item, 'CONFIRMED')}
                          disabled={!canManage || isWorking}
                        >
                          Confirmed
                        </Button>
                        <Button
                          size="small"
                          color="warning"
                          onClick={() => recordStatus(item, 'NO_RESPONSE')}
                          disabled={
                            !canManage
                            || isWorking
                            || item.followUpStatus === 'NO_RESPONSE'
                          }
                        >
                          No response
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} fullWidth maxWidth="md">
        <DialogTitle>Email preview</DialogTitle>
        <DialogContent dividers>
          {preview?.rendered && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">To</Typography>
                <Typography>
                  {Array.isArray(preview.snapshot?.recipientEmails)
                    ? preview.snapshot.recipientEmails.join(', ')
                    : `${preview.snapshot?.recipientName} <${preview.snapshot?.recipientEmail}>`}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Subject</Typography>
                <Typography fontWeight={730}>{preview.rendered.subject}</Typography>
              </Box>
              <Paper variant="outlined" className="builder-follow-up-queue__preview">
                <Typography component="pre">{preview.rendered.text}</Typography>
              </Paper>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>No-response escalation settings</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <FormControlLabel
              control={(
                <Switch
                  checked={settingsDraft.isEnabled}
                  onChange={(event) => setSettingsDraft((current) => ({
                    ...current,
                    isEnabled: event.target.checked,
                  }))}
                />
              )}
              label="Send an internal email when no response remains unresolved"
            />
            <TextField
              label="Wait (business days)"
              type="number"
              value={settingsDraft.waitBusinessDays}
              onChange={(event) => setSettingsDraft((current) => ({
                ...current,
                waitBusinessDays: event.target.value,
              }))}
              slotProps={{ htmlInput: { min: 1, max: 30 } }}
              helperText="Business days currently mean Monday through Friday."
              fullWidth
            />
            <TextField
              label="Internal recipients"
              value={settingsDraft.recipientEmails}
              onChange={(event) => setSettingsDraft((current) => ({
                ...current,
                recipientEmails: event.target.value,
              }))}
              helperText="Separate up to 10 email addresses with commas or new lines."
              multiline
              minRows={3}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)} disabled={workingId === 'settings'}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={saveSettings}
            disabled={workingId === 'settings'}
          >
            Save settings
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(reviewRequest)}
        onClose={() => setReviewRequest(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {reviewDecision === 'APPROVED' ? 'Approve requested date' : 'Keep current date'}
        </DialogTitle>
        <DialogContent dividers>
          {reviewRequest && (
            <Stack spacing={2}>
              <Alert severity={reviewDecision === 'APPROVED' ? 'success' : 'warning'}>
                {reviewDecision === 'APPROVED'
                  ? `This will move ${reviewRequest.stageType} from ${formatDate(reviewRequest.targetWorkDate)} to ${formatDate(reviewRequest.proposedWorkDate)} in the Production schedule.`
                  : `The date will remain ${formatDate(reviewRequest.targetWorkDate)} and this follow-up will be placed on hold for direct contact.`}
              </Alert>
              <Typography variant="body2">
                <strong>{reviewRequest.jobCode}</strong> · {reviewRequest.superintendentName}
              </Typography>
              <TextField
                label="Internal review note (optional)"
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                error={reviewNote.length > 500}
                helperText={`${reviewNote.length}/500 characters`}
                multiline
                minRows={3}
                fullWidth
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewRequest(null)} disabled={Boolean(workingId)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={reviewDecision === 'APPROVED' ? 'success' : 'warning'}
            onClick={resolveReschedule}
            disabled={Boolean(workingId) || reviewNote.length > 500}
          >
            {reviewDecision === 'APPROVED' ? 'Approve and move date' : 'Keep date and place on hold'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
