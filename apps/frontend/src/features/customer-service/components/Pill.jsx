import { alpha } from '@mui/material/styles'
import { Box } from '@mui/material'

// The theme has no grey with a `.main`, so a closed request borrows the muted
// text colour instead of getting a hardcoded hex.
function tone(theme, color) {
  return color === 'neutral'
    ? theme.palette.text.secondary
    : theme.palette[color].main
}

// Tinted label used for the flag under a request number and for the workflow
// status, in the table and in the detail panel. `color` is a palette key so
// the tint follows the theme instead of hardcoding a value.
export default function Pill({ label, color, dense = false }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        px: dense ? 0.625 : 0.875,
        py: dense ? '1px' : '3px',
        // Literal pixels have to be a string: MUI multiplies plain numbers by
        // theme.shape.borderRadius.
        borderRadius: '4px',
        fontSize: dense ? 10 : 11,
        fontWeight: 700,
        lineHeight: 1.5,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        color: tone(theme, color),
        bgcolor: alpha(tone(theme, color), 0.16),
      })}
    >
      {label}
    </Box>
  )
}
