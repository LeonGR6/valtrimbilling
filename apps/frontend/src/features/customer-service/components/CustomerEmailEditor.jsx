import { Paper, Stack, TextField, Typography } from '@mui/material'
import { confirmationTextLimits } from '../utils/customerServiceEmailTemplates.js'

// The editable part of a customer email (greeting and message) and a preview of the whole
// email as the server builds it. The visit details come from the request and are fixed
// (block B, decision 4 of 19 Nov 2026).
export default function CustomerEmailEditor({ to, senderEmail, text, problems, preview, onChange }) {
  const problemFor = (field) => problems.find((problem) => problem.includes(field))
  return (
    <Stack spacing={2}>
      <Typography variant="caption" color="text.secondary">
        To {to} · from your mailbox {senderEmail}. The days, windows, address and work come from the request.
      </Typography>
      <TextField label="Greeting" value={text.greeting} fullWidth
        onChange={(event) => onChange({ ...text, greeting: event.target.value })}
        slotProps={{ htmlInput: { maxLength: confirmationTextLimits.greeting } }}
        error={Boolean(problemFor('greeting'))} helperText={problemFor('greeting') ?? ' '} />
      <TextField label="Message" value={text.message} fullWidth multiline minRows={3}
        onChange={(event) => onChange({ ...text, message: event.target.value })}
        slotProps={{ htmlInput: { maxLength: confirmationTextLimits.message } }}
        error={Boolean(problemFor('message'))} helperText={problemFor('message') ?? ' '} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary" component="div">Preview</Typography>
        <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>{preview.subject}</Typography>
        <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.text}</Typography>
      </Paper>
    </Stack>
  )
}
