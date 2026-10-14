import { useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
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
  DialogContentText,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import { printPdfBytes } from '../../services/printPdf.js'
import {
  markPackageSubmitted,
  sendPackageSubmissionEmail,
} from '../../services/packageSubmissionRepository.js'
import {
  addRecipients,
  defaultSubmissionMessage,
  defaultSubmissionSubject,
  describeSentPackage,
  describeSubmission,
  fitsAsAttachment,
  isValidRecipient,
  newSubmissionRequestId,
  recipientsProblem,
  splitRecipientText,
} from '../../services/packageSubmissionRecord.js'
import { formatFileSize } from '../documents/jobDocumentTypes.js'
import { displayInvoiceNumber } from '../../utils/packageInvoiceLabel.js'

function formatStamp(value) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * The people the email goes to, as chips. The Builder's saved address starts
 * here, and can be removed; more are added by typing them separated by commas
 * (or pressing Enter).
 */
function RecipientsField({ recipients, onChange, disabled, problem }) {
  const [text, setText] = useState('')

  const commit = (raw) => {
    if (!raw.trim()) return
    onChange(addRecipients(recipients, raw))
    setText('')
  }

  return (
    <Autocomplete
      multiple
      freeSolo
      disableClearable
      options={[]}
      value={recipients}
      inputValue={text}
      disabled={disabled}
      onInputChange={(_, next, reason) => {
        if (reason === 'input' && /[,;]/u.test(next)) commit(next)
        else setText(next)
      }}
      onChange={(_, next) => onChange(
        [...new Set(next.flatMap((item) => splitRecipientText(item)))],
      )}
      renderValue={(value, getItemProps) => value.map((email, index) => {
        const { key, ...itemProps } = getItemProps({ index })
        return (
          <Chip
            key={key}
            size="small"
            label={email}
            color={isValidRecipient(email) ? 'default' : 'error'}
            {...itemProps}
          />
        )
      })}
      renderInput={(params) => (
        <TextField
          {...params}
          label="To"
          size="small"
          placeholder={recipients.length === 0 ? 'name@builder.com, other@builder.com' : ''}
          error={Boolean(problem)}
          helperText={problem || 'Type an address and a comma (or Enter) to add it. Remove one with its x.'}
          onBlur={() => commit(text)}
        />
      )}
    />
  )
}

function EmailSubmission({ destination, bundle, packageRecord, job, submissions, onSent }) {
  const context = {
    packageNumber: packageRecord.packageNumber,
    invoiceNumber: displayInvoiceNumber(packageRecord),
    jobCode: job.code,
    community: job.community,
    netAmount: packageRecord.persistedInvoice?.netAmount ?? null,
  }
  // The Builder's saved address is where the list starts.
  const defaultRecipients = splitRecipientText(destination)
  const [recipients, setRecipients] = useState(defaultRecipients)
  const [subject, setSubject] = useState(() => defaultSubmissionSubject(context))
  const [message, setMessage] = useState(() => defaultSubmissionMessage(context))
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(null)
  const [error, setError] = useState(null)
  // One identifier per attempt: sending twice by accident reaches the Builder once.
  const requestId = useRef(newSubmissionRequestId())
  const canAttach = fitsAsAttachment(bundle.bytes)
  const problem = recipientsProblem(recipients)
  const canSend = problem === '' && canAttach && subject.trim() !== '' && !sending
  const isDefaultList = recipients.length === defaultRecipients.length
    && recipients.every((email, index) => email === defaultRecipients[index])

  const send = async () => {
    setConfirming(false)
    setSending(true)
    setError(null)
    try {
      const result = await sendPackageSubmissionEmail({
        packageId: packageRecord.id,
        recipientEmails: recipients,
        subject,
        message,
        fileName: bundle.fileName,
        bytes: bundle.bytes,
        requestId: requestId.current,
      })
      setSent(result)
      onSent?.()
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Stack spacing={2}>
      {!destination && (
        <Alert
          severity="info"
          action={(
            <Button component={RouterLink} to="/builder-draw-schedules" color="inherit" size="small">
              Builder setup
            </Button>
          )}
        >
          This Builder's setup has no email address. Type the recipients below, or add it
          in the Builder setup so it is filled in next time.
        </Alert>
      )}

      <RecipientsField
        recipients={recipients}
        onChange={setRecipients}
        disabled={sending}
        problem={recipients.length === 0 ? problem : ''}
      />
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip
          size="small"
          variant="outlined"
          icon={<AttachFileRoundedIcon />}
          label={`${bundle.fileName} · ${formatFileSize(bundle.bytes.length)}`}
        />
        {defaultRecipients.length > 0 && !isDefaultList && (
          <Button size="small" disabled={sending} onClick={() => setRecipients(defaultRecipients)}>
            Use the Builder's address
          </Button>
        )}
      </Stack>

      {submissions.length > 0 && !sent && (
        <Alert severity="info">
          {describeSentPackage(submissions)}. Sending again emails the Builder a second time.
        </Alert>
      )}

      {!canAttach && (
        <Alert severity="warning">
          The PDF is larger than 15 MB, too big to email. Download it and send it from your
          own email, or leave out a document and generate it again.
        </Alert>
      )}

      <TextField
        label="Subject"
        size="small"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        disabled={sending}
        slotProps={{ htmlInput: { maxLength: 200 } }}
        fullWidth
      />
      <TextField
        label="Message"
        size="small"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={sending}
        multiline
        minRows={5}
        slotProps={{ htmlInput: { maxLength: 3000 } }}
        fullWidth
      />

      {problem && recipients.length > 0 && <Alert severity="warning">{problem}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {sent && (
        <Alert severity="success" icon={<TaskAltRoundedIcon />}>
          Sent to {sent.recipients.join(', ')} on {formatStamp(sent.sentAt)}.
          {sent.workflowStatus === 'AWAITING_PAYMENT' ? ' The Package is now Awaiting payment.' : ''}
          {sent.workflowStatus === null ? ' Its status could not be updated: change it by hand.' : ''}
          {sent.recorded === false ? ' It could not be saved in the Package history.' : ''}
        </Alert>
      )}

      <Box>
        <Button
          variant="contained"
          disableElevation
          startIcon={sending ? <CircularProgress size={18} color="inherit" /> : <SendRoundedIcon />}
          disabled={!canSend}
          onClick={() => setConfirming(true)}
        >
          {sending ? 'Sending…' : sent ? 'Send again' : 'Send email'}
        </Button>
      </Box>

      <Dialog open={confirming} onClose={() => setConfirming(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Send the Package?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {packageRecord.packageNumber} goes to <strong>{recipients.join(', ')}</strong> with
            the PDF attached. They receive it right away.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="contained"
            disableElevation
            onClick={() => {
              // Sending again on purpose is a new attempt.
              if (sent) requestId.current = newSubmissionRequestId()
              send()
            }}
          >
            Send
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

/**
 * The action that submits a Package without email (printing it to mail it, or
 * downloading it for the portal) also moves it to Awaiting payment.
 */
function useSubmitAction(packageRecord, onSent) {
  const [working, setWorking] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  const run = async (action) => {
    setWorking(true)
    setError(null)
    try {
      await action()
      setStatus(await markPackageSubmitted(packageRecord.id))
      onSent?.()
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setWorking(false)
    }
  }

  return { working, status, error, run }
}

function SubmittedNotice({ status, error }) {
  return (
    <>
      {error && <Alert severity="error">{error}</Alert>}
      {status && (
        <Alert severity="success" icon={<TaskAltRoundedIcon />}>
          {status === 'AWAITING_PAYMENT'
            ? 'The Package is now Awaiting payment.'
            : 'The Package was already past Draft, so its status stays as it is.'}
        </Alert>
      )}
    </>
  )
}

function MailSubmission({ destination, bundle, packageRecord, onSent }) {
  const { working, status, error, run } = useSubmitAction(packageRecord, onSent)

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="caption" color="text.secondary">Mail it to</Typography>
        <Typography fontWeight={700} sx={{ whiteSpace: 'pre-line' }}>
          {destination || 'No mailing address in the Builder setup'}
        </Typography>
        {!destination && (
          <Button component={RouterLink} to="/builder-draw-schedules" size="small" sx={{ mt: 0.5 }}>
            Open Builder setup
          </Button>
        )}
      </Box>
      <SubmittedNotice status={status} error={error} />
      <Box>
        <Button
          variant="contained"
          disableElevation
          startIcon={working ? <CircularProgress size={18} color="inherit" /> : <PrintRoundedIcon />}
          disabled={working}
          onClick={() => run(() => printPdfBytes(bundle.bytes))}
        >
          Print package
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          Printing marks the Package as Awaiting payment.
        </Typography>
      </Box>
    </Stack>
  )
}

function PortalSubmission({ destination, packageRecord, onDownload, onSent }) {
  const { working, status, error, run } = useSubmitAction(packageRecord, onSent)

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {destination
          ? <>Upload the PDF to <strong>{destination}</strong>.</>
          : 'Upload the PDF to the Builder portal.'}
      </Typography>
      <SubmittedNotice status={status} error={error} />
      <Box>
        <Button
          variant="contained"
          disableElevation
          startIcon={working ? <CircularProgress size={18} color="inherit" /> : <DownloadRoundedIcon />}
          disabled={working}
          onClick={() => run(async () => onDownload())}
        >
          {destination ? `Download for ${destination}` : 'Download for the portal'}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          Downloading marks the Package as Awaiting payment.
        </Typography>
      </Box>
    </Stack>
  )
}

/**
 * What to do with a Package once it is generated, as the Builder's setup says:
 * email it, print it to mail it, or upload it to the portal.
 */
export default function PackageSubmissionPanel({
  method,
  destination,
  bundle,
  packageRecord,
  job,
  submissions = [],
  onSent = null,
  onDownload,
  anchorRef,
}) {
  const submission = describeSubmission(method, destination)

  return (
    <Paper ref={anchorRef} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', borderColor: 'primary.main' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ px: 2.5, py: 1.75, alignItems: { sm: 'center' }, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}
      >
        <Box
          aria-hidden="true"
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            color: 'primary.contrastText',
            bgcolor: 'primary.main',
            fontWeight: 800,
          }}
        >
          4
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h6" component="h2" fontWeight={800}>
              Send to the builder
            </Typography>
            <Chip size="small" color="primary" variant="outlined" label={submission.title} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            The Package PDF is ready. This Builder receives its packages
            {submission.kind === 'EMAIL' ? ' by email' : submission.kind === 'MAIL' ? ' by mail' : ' through its portal'}.
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={onDownload}>
          Download again
        </Button>
      </Stack>
      <Box sx={{ px: 2.5, py: 2 }}>
        {submission.kind === 'EMAIL' && (
          <EmailSubmission
            destination={submission.target}
            bundle={bundle}
            packageRecord={packageRecord}
            job={job}
            submissions={submissions}
            onSent={onSent}
          />
        )}
        {submission.kind === 'MAIL' && (
          <MailSubmission
            destination={submission.target}
            bundle={bundle}
            packageRecord={packageRecord}
            onSent={onSent}
          />
        )}
        {submission.kind === 'PORTAL' && (
          <PortalSubmission
            destination={submission.target}
            packageRecord={packageRecord}
            onDownload={onDownload}
            onSent={onSent}
          />
        )}
      </Box>
    </Paper>
  )
}
