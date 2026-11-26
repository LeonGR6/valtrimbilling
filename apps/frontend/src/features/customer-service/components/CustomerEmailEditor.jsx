import { Stack, TextField, Typography } from '@mui/material'
import { confirmationTextLimits } from '../utils/customerServiceEmailTemplates.js'
import CustomerEmailPreview from './CustomerEmailPreview.jsx'

// The editable part of a customer email (greeting and message) and, when given, a preview of
// the whole email below it. The visit details come from the request and are fixed (block B,
// decision 4 of 19 Nov 2026). Without `to` the recipient is shown by the dialog itself.
export default function CustomerEmailEditor({ to, senderEmail, text, problems, preview, onChange }) {
  const problemFor = (field) => problems.find((problem) => problem.includes(field))
  return (
    <Stack spacing={2}>
      <Typography variant="caption" color="text.secondary">
        {to ? `To ${to} · from` : 'From'} your mailbox {senderEmail}. The days, windows, address and work come from the
        request.
      </Typography>
      <TextField label="Greeting" value={text.greeting} fullWidth
        onChange={(event) => onChange({ ...text, greeting: event.target.value })}
        slotProps={{ htmlInput: { maxLength: confirmationTextLimits.greeting } }}
        error={Boolean(problemFor('greeting'))} helperText={problemFor('greeting') ?? ' '} />
      <TextField label="Message" value={text.message} fullWidth multiline minRows={3}
        onChange={(event) => onChange({ ...text, message: event.target.value })}
        slotProps={{ htmlInput: { maxLength: confirmationTextLimits.message } }}
        error={Boolean(problemFor('message'))} helperText={problemFor('message') ?? ' '} />
      {preview && <CustomerEmailPreview preview={preview} />}
    </Stack>
  )
}
