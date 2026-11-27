import { Chip } from '@mui/material'
import { userStatusByValue } from '../data/users.js'

export default function UserStatusChip({ status }) {
  const details = userStatusByValue[status] ?? {
    label: 'Unknown',
    color: 'default',
  }

  return (
    <Chip
      label={details.label}
      color={details.color}
      size="small"
      variant="outlined"
    />
  )
}
