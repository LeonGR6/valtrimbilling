import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { emailAutomationDispatchErrors, emailAutomationMessage } from '../services/customerServiceEmailAutomation.js'

export default function EmailAutomationStatus({ status, error, onRefresh }) {
  const message = error ? { severity: 'warning', text: error } : emailAutomationMessage(status)
  const codes = [status?.errorCode, status?.connectionError, status?.scan?.errorCode,
    ...emailAutomationDispatchErrors(status)
      .map((entry) => `${entry.kind}: ${entry.errorCode}${entry.httpStatus ? ` (${entry.httpStatus})` : ''}`)].filter(Boolean)
  return (
    <Alert severity={message.severity} variant="outlined" sx={{ mb: 2, flexWrap: { xs: 'wrap', sm: 'nowrap' },
      '& .MuiAlert-message': { flex: 1, minWidth: 0 }, '& .MuiAlert-action': { width: { xs: '100%', sm: 'auto' }, m: 0, pl: { xs: 4, sm: 2 } } }}
      action={message.severity === 'warning' && onRefresh ? <Button color="inherit" onClick={() => { void onRefresh() }}>Check connection</Button> : undefined}>
      <Stack spacing={0.5}>
        <Typography variant="body2">{message.text}</Typography>
        {codes.length > 0 && <Box component="details"><Typography component="summary" variant="caption">Connection details</Typography>
          <Typography variant="caption">{codes.join(' · ')}</Typography></Box>}
      </Stack>
    </Alert>
  )
}
