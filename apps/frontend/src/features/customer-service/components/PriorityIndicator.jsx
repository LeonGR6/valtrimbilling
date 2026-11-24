import { Box, Typography } from '@mui/material'
import SignalCellularAlt1BarIcon from '@mui/icons-material/SignalCellularAlt1Bar'
import SignalCellularAlt2BarIcon from '@mui/icons-material/SignalCellularAlt2Bar'
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt'
import { prioritiesByValue } from '../data/customerService.js'
import Pill from './Pill.jsx'

// Signal bars: high three in red, medium two in amber, low one in gray (decided 24 Nov 2026).
const levels = {
  LOW: { Icon: SignalCellularAlt1BarIcon, color: 'text.secondary' },
  MEDIUM: { Icon: SignalCellularAlt2BarIcon, color: 'warning.main' },
  HIGH: { Icon: SignalCellularAltIcon, color: 'error.main' },
}

// A request's priority. In the lists ('pill'): a gray PRIORITY label, in the style of the
// stage label, followed by the level's bars; the level is also in the tooltip and for
// screen readers. In the request detail ('detail'), where the field is already called
// Priority: the bars and the level written out.
export default function PriorityIndicator({ priority, variant = 'pill' }) {
  const option = prioritiesByValue[priority]
  const level = levels[option?.value]
  if (!option || !level) return null
  const { Icon } = level
  return (
    <Box component="span" title={`${option.label} priority`} aria-label={`${option.label} priority`}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {variant === 'pill' && <Pill dense label="Priority" color="neutral" />}
      <Icon aria-hidden sx={{ fontSize: variant === 'pill' ? 18 : 20, color: level.color }} />
      {variant === 'detail' && (
        <Typography component="span" variant="body2" fontWeight={600}>{option.label}</Typography>
      )}
    </Box>
  )
}
