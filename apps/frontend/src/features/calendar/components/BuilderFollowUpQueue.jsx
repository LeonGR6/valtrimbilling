import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import {
  getBuilderFollowUpEmailMode,
  listBuilderFollowUps,
  previewBuilderFollowUpEmail,
  recordBuilderFollowUpStatus,
  refreshBuilderFollowUps,
  sendBuilderFollowUpEmail,
  sendDueBuilderFollowUpEmails,
} from '../services/builderFollowUpRepository.js'
import {
  followUpDeliveryLabel,
  followUpLotsLabel,
} from '../services/builderFollowUpRecord.js'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T12:00:00Z`))
}

function statusColor(status) {
  if (status === 'OVERDUE' || status === 'FAILED') return 'error'
  if (status === 'DUE') return 'warning'
  if (status === 'UPCOMING') return 'info'
  return 'default'
}

export default function BuilderFollowUpQueue({ canManage = false }) {
  const [items, setItems] = useState([])
  const [mode, setMode] = useState('PREVIEW')
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (canManage) await refreshBuilderFollowUps()
      const [nextItems, status] = await Promise.all([
        listBuilderFollowUps(),
        canManage
          ? getBuilderFollowUpEmailMode()
          : Promise.resolve({ mode: 'PREVIEW' }),
      ])
      setItems(nextItems)
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

  const dueCount = useMemo(() => items.filter(({ deliveryStatus }) => (
    ['DUE', 'OVERDUE', 'FAILED'].includes(deliveryStatus)
  )).length, [items])

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
      setNotice(`Due email run finished: ${result.sent} sent, ${result.failed} failed.`)
      await load()
    } catch (runError) {
      setError(runError.message)
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
            {items.length} open checkpoint{items.length === 1 ? '' : 's'}; {dueCount} due, overdue or failed.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="flex-end">
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
            disabled={!canManage || mode !== 'LIVE' || dueCount === 0 || Boolean(workingId)}
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

      {loading ? (
        <Box className="builder-follow-up-queue__loading"><CircularProgress size={30} /></Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" className="builder-follow-up-queue__empty">
          <CheckCircleRoundedIcon color="success" />
          <Typography fontWeight={720}>No open Builder follow-ups.</Typography>
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
                          disabled={!canManage || isWorking}
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
                <Typography>{preview.snapshot?.recipientName} &lt;{preview.snapshot?.recipientEmail}&gt;</Typography>
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
    </Box>
  )
}
