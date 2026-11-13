import { Chip } from '@mui/material'

import { allChangeOrderStatuses } from '../data/changeOrders.js'

const STATUS_COLORS = { DRAFT: 'default', PENDING: 'warning', APPROVED: 'success', CANCELLED: 'error' }

export default function ChangeOrderStatusChip({ status }) {
  const label = allChangeOrderStatuses.find((item) => item.value === status)?.label ?? status

  return (
    <Chip
      size="small"
      variant="outlined"
      color={STATUS_COLORS[status] ?? 'default'}
      label={label}
      sx={{ fontWeight: 600 }}
    />
  )
}
