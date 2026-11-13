import { Chip } from '@mui/material'

/** Says whether an invoice goes to the real QuickBooks (Production) or to the Test company. */
export default function QuickbooksEnvironmentChip({ environment, sx = undefined }) {
  if (!environment) return null

  const isProduction = environment === 'production'

  return (
    <Chip
      size="small"
      color={isProduction ? 'error' : 'warning'}
      label={isProduction ? 'PRODUCTION · real invoice' : 'TEST · not real'}
      sx={{ fontWeight: 800, ...sx }}
    />
  )
}
