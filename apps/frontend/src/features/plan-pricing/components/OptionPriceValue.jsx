import { Chip, Typography } from '@mui/material'
import { hasPrice, formatOptionPrice } from '../utils/planPriceFormat.js'

// What an Option costs: its price, "NA", or a warning when it has none yet.
export default function OptionPriceValue({ option }) {
  if (!hasPrice(option.price)) {
    return (
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        label="Not priced"
        sx={{ fontWeight: 700 }}
      />
    )
  }

  return (
    <Typography variant="body2" fontWeight={750}>
      {formatOptionPrice(option)}
    </Typography>
  )
}
