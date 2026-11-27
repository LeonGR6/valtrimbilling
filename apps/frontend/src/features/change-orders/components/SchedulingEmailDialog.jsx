import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Autocomplete,
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
  Tooltip,
  Typography,
} from '@mui/material'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'

import {
  addRecipients,
  describeMissingRoles,
  emailDraftFromPreview,
  removeRecipient,
  validateRecipients,
} from '../../purchase-orders/services/purchaseOrderEmailRecord.js'
import {
  MAX_SEQUENCE_SHEET_SUBJECT_LENGTH,
  sequenceSheetEmailPreviewDocument,
  validateSequenceSheetSubject,
} from '../../sequence-sheets/services/sequenceSheetEmailRecord.js'
import { describeSchedulingEmailSent } from '../services/changeOrderEmailRecord.js'
import {
  previewSchedulingEmail,
  sendSchedulingEmail,
} from '../services/changeOrderEmailRepository.js'

function newRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Offers to tell the Job's Scheduling contact which lots of an Extra / CO are charged with a Calendar
 * event (EXT, DM or HW). It shows the exact email, starts with Scheduling as the recipient, and lets the
 * user remove it or add anyone else. Nothing is sent until "Send email"; "Don't send" tells no one.
 * `onSent` receives the sentence to show once it is out; `onClose` is called for "Don't send" too.
 */
export default function SchedulingEmailDialog({ changeOrderId, onClose, onSent }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recipients, setRecipients] = useState([])
  const [subject, setSubject] = useState('')
  const [typed, setTyped] = useState('')
  const [recipientError, setRecipientError] = useState('')
  const [subjectError, setSubjectError] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // One identifier per opening: a retry after a failure cannot send the email twice.
  const requestId = useRef(newRequestId())

  useEffect(() => {
    let ignore = false

    previewSchedulingEmail(changeOrderId)
      .then((result) => {
        if (ignore) return
        const draft = emailDraftFromPreview(result)
        setPreview({ ...result, missingRoles: draft.missingRoles })
        setRecipients(draft.recipients)
        setSubject(draft.subject)
      })
      .catch((previewError) => {
        if (!ignore) setError(previewError.message)
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [changeOrderId])

  const roleByEmail = useMemo(
    () => new Map(recipients.map(({ email, role }) => [email, role])),
    [recipients],
  )
  const missingMessage = preview ? describeMissingRoles(preview.missingRoles) : null
  const number = preview?.snapshot?.number

  const commit = (values) => {
    const result = addRecipients(recipients, values)
    setRecipients(result.recipients)
    setRecipientError(result.error)
  }

  const handleSend = async () => {
    const checkedRecipients = validateRecipients(recipients)
    const checkedSubject = validateSequenceSheetSubject(subject)
    setRecipientError(checkedRecipients.success ? '' : checkedRecipients.error)
    setSubjectError(checkedSubject.success ? '' : checkedSubject.error)
    if (!checkedRecipients.success || !checkedSubject.success) return

    setSending(true)
    setError('')
    try {
      const result = await sendSchedulingEmail({
        changeOrderId,
        recipientEmails: checkedRecipients.emails,
        subject: checkedSubject.subject,
        requestId: requestId.current,
      })
      onSent(describeSchedulingEmailSent(result))
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
      aria-labelledby="scheduling-email-title"
      slotProps={{
        paper: { sx: { maxHeight: { xs: '100%', sm: 'calc(100% - 48px)' } } },
      }}
    >
      <DialogTitle id="scheduling-email-title">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h5" component="span" fontWeight={750} sx={{ display: 'block' }}>
              {number ? `Tell Scheduling about ${number}?` : 'Tell Scheduling?'}
            </Typography>
            <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
              These lots are charged with an event already on the Calendar. Review the email, and who
              gets it, before sending.
            </Typography>
          </Box>
          <Chip size="small" color="info" variant="outlined" label="HTML email · No attachments" />
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.25}>
          {error && <Alert severity="error">{error}</Alert>}

          {loading && (
            <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
              <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
                <CircularProgress size={30} />
                <Typography variant="body2" color="text.secondary">
                  Building email preview…
                </Typography>
              </Stack>
            </Box>
          )}

          {preview && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={2}>
                {missingMessage && <Alert severity="info">{missingMessage}</Alert>}

                <Autocomplete
                  multiple
                  freeSolo
                  autoSelect
                  options={[]}
                  value={recipients.map(({ email }) => email)}
                  inputValue={typed}
                  disabled={sending}
                  onChange={(_, values, reason) => {
                    if (reason === 'removeOption' || reason === 'clear') {
                      setRecipients((current) => current.filter(({ email }) => values.includes(email)))
                      setRecipientError('')
                      return
                    }
                    commit(values)
                  }}
                  onInputChange={(_, text, reason) => {
                    // A comma, semicolon or space ends an address, like pressing Enter.
                    if (reason === 'input' && /[,;\s]$/u.test(text) && text.trim() !== '') {
                      commit([text])
                      setTyped('')
                      return
                    }
                    setTyped(text)
                  }}
                  renderValue={(values, getItemProps) => values.map((email, index) => {
                    const { key, ...itemProps } = getItemProps({ index })
                    const role = roleByEmail.get(email)
                    return (
                      <Tooltip key={key} title={role ?? 'Added by you'}>
                        <Chip
                          size="small"
                          color={role ? 'primary' : 'default'}
                          variant={role ? 'filled' : 'outlined'}
                          label={role ? `${role} · ${email}` : email}
                          {...itemProps}
                          onDelete={() => setRecipients((current) => removeRecipient(current, email))}
                        />
                      </Tooltip>
                    )
                  })}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Recipients"
                      placeholder={recipients.length === 0 ? 'name@example.com' : 'Add another email'}
                      error={Boolean(recipientError)}
                      helperText={
                        recipientError
                        || 'The Scheduling contact of the Job is suggested. Remove it with ✕, or type an email and press Enter to add one.'
                      }
                    />
                  )}
                />

                <TextField
                  label="Subject"
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value)
                    setSubjectError('')
                  }}
                  error={Boolean(subjectError)}
                  helperText={subjectError || ' '}
                  disabled={sending}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: MAX_SEQUENCE_SHEET_SUBJECT_LENGTH } }}
                />
              </Stack>
            </Paper>
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
                  Rendered email
                </Typography>
              </Box>
              <Box
                component="iframe"
                title="Rendered email"
                srcDoc={sequenceSheetEmailPreviewDocument(preview.rendered.html)}
                sandbox=""
                sx={{ display: 'block', width: '100%', height: 480, border: 0, bgcolor: '#f8fafc' }}
              />
            </Paper>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={sending}>Don&apos;t send</Button>
        <Button
          variant="contained"
          disableElevation
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <EmailRoundedIcon />}
          onClick={handleSend}
          disabled={loading || !preview?.rendered || sending}
        >
          {sending ? 'Sending…' : 'Send email'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
