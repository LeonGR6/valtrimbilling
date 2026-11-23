import { Box, Paper, Stack, TextField, Typography } from '@mui/material'
import { confirmationTextLimits } from '../utils/customerServiceEmailTemplates.js'

// The editable part of a customer email (greeting and message) and a preview of the whole
// email, in the same HTML the server sends. The visit details come from the request and are fixed
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
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary" component="div">Preview · as the customer sees it</Typography>
          <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>{preview.subject}</Typography>
        </Box>
        {/* The same HTML the server sends. sandbox="" runs no scripts and links nothing. */}
        <Box component="iframe" title="Email preview" sandbox="" srcDoc={preview.html}
          sx={{ display: 'block', width: '100%', height: 520, border: 0, borderTop: 1, borderColor: 'divider' }} />
      </Paper>
    </Stack>
  )
}
