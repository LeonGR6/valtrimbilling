import { useEffect, useRef, useState } from 'react'
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
  TextField,
  Typography,
} from '@mui/material'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import {
  MAX_SEQUENCE_SHEET_SUBJECT_LENGTH,
  parseSequenceSheetRecipients,
  sequenceSheetEmailDrafts,
  sequenceSheetEmailPreviewDocument,
  validateSequenceSheetSubject,
} from '../services/sequenceSheetEmailRecord.js'
import {
  previewSequenceSheetEmail,
  sendSequenceSheetEmail,
} from '../services/sequenceSheetEmailRepository.js'

function newRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatRoles(roles) {
  return roles.length > 1
    ? `${roles.slice(0, -1).join(', ')} and ${roles.at(-1)}`
    : roles.join('')
}

export default function SequenceSheetEmailDialog({
  phase,
  onClose,
  onSent,
}) {
  const [drafts, setDrafts] = useState([])
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Emails that already went out, so a retry after a failure only sends the rest.
  const sentResultsRef = useRef([])

  useEffect(() => {
    let ignore = false

    previewSequenceSheetEmail(phase.id)
      .then((result) => {
        if (ignore) return
        setPreview(result)
        setDrafts(sequenceSheetEmailDrafts(result).map((draft) => ({
          ...draft,
          requestId: newRequestId(),
          recipientError: '',
          subjectError: '',
          sent: false,
        })))
      })
      .catch((previewError) => {
        if (!ignore) setError(previewError.message)
      })
      .finally(() => {
        if (!ignore) setLoadingPreview(false)
      })

    return () => {
      ignore = true
    }
  }, [phase.id])

  const updateDraft = (key, changes) => {
    setDrafts((current) => current.map((draft) => (
      draft.key === key ? { ...draft, ...changes } : draft
    )))
  }

  const pendingDrafts = drafts.filter((draft) => !draft.sent)

  const sendEmails = async () => {
    const checked = drafts.map((draft) => {
      if (draft.sent) return { draft, valid: true }
      const recipients = parseSequenceSheetRecipients(draft.recipientText)
      const subject = validateSequenceSheetSubject(draft.subject)

      return {
        draft: {
          ...draft,
          recipientError: recipients.success ? '' : recipients.error,
          subjectError: subject.success ? '' : subject.error,
        },
        recipients: recipients.recipients,
        subject: subject.subject,
        valid: recipients.success && subject.success,
      }
    })

    setDrafts(checked.map(({ draft }) => draft))
    if (checked.some(({ valid }) => !valid)) return

    setSending(true)
    setError('')
    try {
      for (const { draft, recipients, subject } of checked) {
        if (draft.sent) continue

        const result = await sendSequenceSheetEmail(
          phase.id,
          recipients,
          draft.requestId,
          subject,
        )
        sentResultsRef.current.push(result)
        updateDraft(draft.key, { sent: true })
      }
      onSent(sentResultsRef.current)
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setSending(false)
    }
  }

  const multipleEmails = drafts.length > 1

  return (
    <Dialog
      open
      onClose={sending ? undefined : onClose}
      fullWidth
      maxWidth="lg"
      slotProps={{
        paper: {
          sx: { maxHeight: { xs: '100%', sm: 'calc(100% - 48px)' } },
        },
      }}
    >
      <DialogTitle>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h5" component="h2" fontWeight={750}>
              Email Sequence Sheet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {multipleEmails
                ? 'This is the first Sequence Sheet of the job, so two emails go out. Review who gets each one and its subject.'
                : 'Review the HTML table, the subject and who should receive it.'}
            </Typography>
          </Box>
          <Chip size="small" color="info" variant="outlined" label="HTML email · No attachments" />
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.25}>
          {error && <Alert severity="error">{error}</Alert>}

          {drafts.map((draft, index) => (
            <Paper key={draft.key} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={2}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography fontWeight={750}>
                    {multipleEmails ? `Email ${index + 1} · ${draft.label}` : 'Email'}
                  </Typography>
                  {draft.sent && (
                    <Chip size="small" color="success" label="Sent" />
                  )}
                </Stack>
                <TextField
                  label="Recipients"
                  value={draft.recipientText}
                  onChange={(event) => updateDraft(draft.key, {
                    recipientText: event.target.value,
                    recipientError: '',
                  })}
                  error={Boolean(draft.recipientError)}
                  helperText={
                    draft.recipientError
                    || [
                      draft.recipientRoles.length > 0
                        ? `Suggested: ${formatRoles(draft.recipientRoles)}.`
                        : null,
                      'Separate multiple email addresses with commas.',
                    ].filter(Boolean).join(' ')
                  }
                  placeholder="coordinator@example.com"
                  disabled={sending || draft.sent}
                  fullWidth
                />
                <TextField
                  label="Subject"
                  value={draft.subject}
                  onChange={(event) => updateDraft(draft.key, {
                    subject: event.target.value,
                    subjectError: '',
                  })}
                  error={Boolean(draft.subjectError)}
                  helperText={draft.subjectError || ' '}
                  disabled={sending || draft.sent}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: MAX_SEQUENCE_SHEET_SUBJECT_LENGTH } }}
                />
              </Stack>
            </Paper>
          ))}

          {loadingPreview && (
            <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
              <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
                <CircularProgress size={30} />
                <Typography variant="body2" color="text.secondary">
                  Building email preview…
                </Typography>
              </Stack>
            </Box>
          )}

          {preview?.rendered && (
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Box
                sx={{
                  px: 2,
                  py: 1.25,
                  borderBottom: 1,
                  borderColor: 'divider',
                  bgcolor: 'action.hover',
                }}
              >
                <Typography variant="overline" color="text.secondary">
                  Rendered email{multipleEmails ? ' (same body in both emails)' : ''}
                </Typography>
              </Box>
              <Box
                component="iframe"
                title="Rendered Sequence Sheet email"
                srcDoc={sequenceSheetEmailPreviewDocument(preview.rendered.html)}
                sandbox=""
                sx={{ display: 'block', width: '100%', height: 560, border: 0, bgcolor: '#f8fafc' }}
              />
            </Paper>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={sending}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <EmailRoundedIcon />}
          onClick={sendEmails}
          disabled={
            loadingPreview || !preview?.rendered || sending || pendingDrafts.length === 0
          }
          disableElevation
        >
          {sending
            ? 'Sending…'
            : pendingDrafts.length > 1
              ? `Send ${pendingDrafts.length} emails`
              : 'Send email'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
