import { useEffect, useState } from 'react'
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
  parseSequenceSheetRecipients,
  sequenceSheetEmailPreviewDocument,
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

export default function SequenceSheetEmailDialog({
  defaultRecipientEmail,
  phase,
  onClose,
  onSent,
}) {
  const [recipientText, setRecipientText] = useState(defaultRecipientEmail ?? '')
  const [recipientError, setRecipientError] = useState('')
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [requestId] = useState(newRequestId)

  useEffect(() => {
    let ignore = false

    previewSequenceSheetEmail(phase.id)
      .then((result) => {
        if (!ignore) {
          setPreview(result)
          setRecipientText((current) => (
            current.trim()
              ? current
              : result.snapshot?.defaultRecipientEmail ?? ''
          ))
        }
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

  const sendEmail = async () => {
    const parsed = parseSequenceSheetRecipients(recipientText)
    if (!parsed.success) {
      setRecipientError(parsed.error)
      return
    }

    setSending(true)
    setError('')
    try {
      const result = await sendSequenceSheetEmail(
        phase.id,
        parsed.recipients,
        requestId,
      )
      onSent(result)
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setSending(false)
    }
  }

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
              Review the HTML table and choose who should receive it.
            </Typography>
          </Box>
          <Chip size="small" color="info" variant="outlined" label="HTML email · No attachments" />
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.25}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Recipients"
            value={recipientText}
            onChange={(event) => {
              setRecipientText(event.target.value)
              if (recipientError) setRecipientError('')
            }}
            error={Boolean(recipientError)}
            helperText={recipientError || 'Separate multiple email addresses with commas.'}
            placeholder="superintendent@example.com"
            disabled={sending}
            fullWidth
          />

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
            <>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="caption" color="text.secondary">Subject</Typography>
                <Typography fontWeight={730}>{preview.rendered.subject}</Typography>
              </Paper>
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
                    Rendered email
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
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={sending}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <EmailRoundedIcon />}
          onClick={sendEmail}
          disabled={loadingPreview || !preview?.rendered || sending}
          disableElevation
        >
          {sending ? 'Sending…' : 'Send email'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
