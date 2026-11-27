import { Chip } from '@mui/material'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'

// Warns that some options of a Plan have no price yet (NA counts as priced), open
// or closed, so a missing price is never hidden behind a collapsed Plan.
export default function MissingPricesChip({ summary }) {
  const { missing } = summary
  if (missing === 0) return null

  return (
    <Chip
      size="small"
      color="warning"
      variant="outlined"
      icon={<WarningAmberRoundedIcon />}
      label={`${missing} ${missing === 1 ? 'option' : 'options'} without price`}
      sx={{ fontWeight: 700 }}
    />
  )
}
