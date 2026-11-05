import { useId } from 'react'
import { Box, Paper, Typography } from '@mui/material'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'

import { visuallyHiddenSx } from '../../../components/common/CatalogPage'

/**
 * One of the steps of the Extra / CO form. The number is a real order (who asks, where the work is,
 * what is charged) and turns into a check once the step is complete; after a failed save a step that
 * is still incomplete (`attention`) is marked in red.
 */
export default function ChangeOrderFormSection({
  step,
  title,
  hint,
  done = false,
  attention = false,
  children,
}) {
  const headingId = useId()
  const markColor = done ? 'success.main' : attention ? 'error.main' : 'text.secondary'

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby={headingId}
      sx={{ borderRadius: 2 }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: { xs: 2, md: 3 },
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box
          aria-hidden
          sx={{
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 13,
            fontWeight: 700,
            border: 1.5,
            borderColor: markColor,
            color: done ? 'success.contrastText' : markColor,
            bgcolor: done ? 'success.main' : 'transparent',
          }}
        >
          {done ? <CheckRoundedIcon sx={{ fontSize: 18 }} /> : step}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography id={headingId} variant="subtitle1" component="h2" fontWeight={700}>
            {title}
          </Typography>
          {hint && (
            <Typography variant="body2" color="text.secondary">
              {hint}
            </Typography>
          )}
        </Box>
        <Typography component="span" sx={visuallyHiddenSx}>
          {done ? 'Complete' : 'Not complete yet'}
        </Typography>
      </Box>
      <Box sx={{ p: { xs: 2, md: 3 } }}>{children}</Box>
    </Paper>
  )
}
