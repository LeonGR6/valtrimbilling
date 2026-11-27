import { Box, Stack, Typography } from '@mui/material'

// Parts shared by the dialogs that email a customer: Send to customer, and moving or
// cancelling a visit (Reschedule block, 27 Nov 2026).

// A titled part of the form, kept apart from the next one by the dialog's spacing.
export function Section({ title, children }) {
  return (
    <Stack component="section" spacing={1.5}>
      <Typography variant="subtitle2" component="h3" fontWeight={700}>{title}</Typography>
      {children}
    </Stack>
  )
}

// The tinted box a day sits in.
export function DayBox({ children, sx = null }) {
  return <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover', ...sx }}>{children}</Box>
}

// A day as the coordinator reads it: { date, detail } with the work hours and technicians.
// struck: the day a visit no longer has.
export function DayDetails({ label, day, struck = false }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      {label && (
        <Typography variant="caption" color={struck ? 'text.secondary' : 'primary'} fontWeight={700} component="div"
          sx={{ letterSpacing: 0.5 }}>
          {label}
        </Typography>
      )}
      <Typography variant="body2" fontWeight={700} sx={struck ? { textDecoration: 'line-through', color: 'text.secondary' } : null}>
        {day.date}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={struck ? { textDecoration: 'line-through' } : null}>
        {day.detail}
      </Typography>
    </Box>
  )
}

// The preview column when no email is sent.
export function NoEmailNote({ children }) {
  return (
    <Box sx={{
      height: { md: '100%' }, minHeight: 160, display: 'grid', placeItems: 'center', p: 3, textAlign: 'center',
      border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 2,
    }}>
      <Typography variant="body2" color="text.secondary">{children}</Typography>
    </Box>
  )
}
