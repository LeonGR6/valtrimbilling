import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import {
  getBuilderFollowUpPublicResponse,
  submitBuilderFollowUpPublicResponse,
} from '../../features/calendar/services/builderFollowUpPublicResponse.js'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatDate(value) {
  if (!value) return ''
  return dateFormatter.format(new Date(`${value}T12:00:00Z`))
}

function lotsLabel(response) {
  if (!response?.lotStartLabel && !response?.lotEndLabel) return 'Lots not specified'
  if (!response.lotEndLabel || response.lotStartLabel === response.lotEndLabel) {
    return `Lot ${response.lotStartLabel || response.lotEndLabel}`
  }
  return `Lots ${response.lotStartLabel}–${response.lotEndLabel}`
}

function submittedMessage(response) {
  if (response.responseAction === 'CONFIRMED') {
    return 'Thank you. ValTrim received your confirmation.'
  }
  return 'Thank you. ValTrim updated the official Production date.'
}

export default function BuilderFollowUpResponse() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim() ?? ''
  const requestedIntent = searchParams.get('intent') === 'not-ready'
    ? 'NOT_READY'
    : 'CONFIRMED'
  const [response, setResponse] = useState(null)
  const [intent, setIntent] = useState(requestedIntent)
  const [proposedWorkDate, setProposedWorkDate] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(Boolean(token))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(token
    ? ''
    : 'This response link is incomplete. Please open the complete link from the email.')

  useEffect(() => {
    let active = true
    if (!token) {
      return () => { active = false }
    }

    getBuilderFollowUpPublicResponse(token)
      .then((nextResponse) => {
        if (!active) return
        setResponse(nextResponse)
        if (!nextResponse.alreadySubmitted) {
          setProposedWorkDate(nextResponse.minimumProposedDate)
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [token])

  const canSubmit = useMemo(() => (
    response
    && !response.alreadySubmitted
    && !submitting
    && (intent === 'CONFIRMED' || proposedWorkDate >= response.minimumProposedDate)
    && reason.length <= 500
  ), [intent, proposedWorkDate, reason.length, response, submitting])

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const result = await submitBuilderFollowUpPublicResponse({
        token,
        response: intent,
        proposedWorkDate: intent === 'NOT_READY' ? proposedWorkDate : null,
        reason: intent === 'NOT_READY' ? reason : null,
      })
      setResponse({
        ...result,
        alreadySubmitted: true,
        responseAction: intent,
        workDate: response.workDate,
        proposedWorkDate: intent === 'NOT_READY' ? proposedWorkDate : null,
        recipientName: response.recipientName,
      })
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default', py: { xs: 3, md: 7 } }}>
      <Container maxWidth="sm">
        <Stack spacing={2.5}>
          <Box textAlign="center">
            <Typography variant="overline" color="primary" fontWeight={800} letterSpacing={1.5}>
              ValTrim Scheduling
            </Typography>
            <Typography variant="h4" fontWeight={820}>Jobsite readiness response</Typography>
          </Box>

          <Paper variant="outlined" sx={{ p: { xs: 2.25, sm: 3.5 }, borderRadius: 3 }}>
            {loading ? (
              <Stack alignItems="center" spacing={2} py={5}>
                <CircularProgress />
                <Typography color="text.secondary">Loading the schedule details…</Typography>
              </Stack>
            ) : error && !response ? (
              <Alert severity="error">{error}</Alert>
            ) : response?.alreadySubmitted ? (
              <Stack spacing={2.5} alignItems="center" textAlign="center" py={2}>
                <CheckCircleRoundedIcon color="success" sx={{ fontSize: 58 }} />
                <Box>
                  <Typography variant="h5" fontWeight={780}>Response received</Typography>
                  <Typography color="text.secondary" sx={{ mt: 1 }}>
                    {submittedMessage(response)}
                  </Typography>
                </Box>
                <Alert severity={response.responseAction === 'CONFIRMED' ? 'success' : 'info'}>
                  {response.responseAction === 'CONFIRMED'
                    ? `Confirmed for ${formatDate(response.finalWorkDate ?? response.workDate)}.`
                    : `New Production date: ${formatDate(response.finalWorkDate ?? response.proposedWorkDate)}.`}
                </Alert>
                {response.notificationIds?.length > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    A confirmation email has been queued for you.
                  </Typography>
                )}
                <Typography variant="body2" color="text.secondary">
                  You can close this page. Reopening the link will not create a duplicate response.
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={3}>
                <Box>
                  <Typography variant="h5" fontWeight={780}>
                    {response.stageType} · {response.jobCode}
                  </Typography>
                  <Typography color="text.secondary">
                    {response.community} · {response.builderName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Phase {response.phaseCode} · {lotsLabel(response)}
                  </Typography>
                </Box>

                <Alert icon={<CalendarMonthRoundedIcon />} severity="info">
                  Current Production date: <strong>{formatDate(response.workDate)}</strong>
                </Alert>

                <Box>
                  <Typography fontWeight={740} gutterBottom>
                    Hello {response.recipientName}, is the Jobsite ready for this work?
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Choose one response below. Nothing is recorded until you press the final submit button.
                  </Typography>
                </Box>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Button
                    fullWidth
                    size="large"
                    variant={intent === 'CONFIRMED' ? 'contained' : 'outlined'}
                    color="success"
                    startIcon={<CheckCircleRoundedIcon />}
                    onClick={() => setIntent('CONFIRMED')}
                  >
                    Confirmed
                  </Button>
                  <Button
                    fullWidth
                    size="large"
                    variant={intent === 'NOT_READY' ? 'contained' : 'outlined'}
                    color="warning"
                    startIcon={<EventBusyRoundedIcon />}
                    onClick={() => setIntent('NOT_READY')}
                  >
                    Not ready
                  </Button>
                </Stack>

                {intent === 'NOT_READY' && (
                  <Stack spacing={2}>
                    <Divider />
                    <Alert severity="warning">
                      Submitting this response immediately changes the official Production date to the date you select. No additional approval is required.
                    </Alert>
                    <TextField
                      label="Requested work date"
                      type="date"
                      value={proposedWorkDate}
                      onChange={(event) => setProposedWorkDate(event.target.value)}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: { min: response.minimumProposedDate },
                      }}
                      helperText={`Select a date after ${formatDate(response.workDate)}.`}
                      required
                      fullWidth
                    />
                    <TextField
                      label="Reason or readiness conflict (optional)"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      error={reason.length > 500}
                      helperText={`${reason.length}/500 characters`}
                      multiline
                      minRows={3}
                      fullWidth
                    />
                  </Stack>
                )}

                {error && <Alert severity="error">{error}</Alert>}

                <Button
                  variant="contained"
                  color={intent === 'CONFIRMED' ? 'success' : 'warning'}
                  size="large"
                  onClick={submit}
                  disabled={!canSubmit}
                >
                  {submitting
                    ? 'Submitting…'
                    : intent === 'CONFIRMED'
                      ? 'Submit confirmation'
                      : 'Update Production date'}
                </Button>
              </Stack>
            )}
          </Paper>

          <Typography variant="caption" color="text.secondary" textAlign="center">
            ValtrimBilling is the source of truth for the Production schedule.
          </Typography>
        </Stack>
      </Container>
    </Box>
  )
}
