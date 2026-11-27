import { Chip, Tooltip } from '@mui/material'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'

/**
 * Shows only the invoices QuickBooks says were paid in part. It is lit while any exist, so it is
 * noticed before it is pressed, and it keeps its count in the label.
 */
export default function PartiallyPaidFilter({ active, count, onToggle, sx = undefined }) {
  const lit = active || count > 0

  return (
    <Tooltip title="Invoices that were paid in part: something was paid and something is still due.">
      <Chip
        clickable
        aria-pressed={active}
        color={lit ? 'warning' : 'default'}
        variant={active ? 'filled' : 'outlined'}
        icon={<PaymentsRoundedIcon />}
        label={`Partially paid · ${count}`}
        onClick={onToggle}
        sx={{ flexShrink: 0, fontWeight: 750, ...sx }}
      />
    </Tooltip>
  )
}
