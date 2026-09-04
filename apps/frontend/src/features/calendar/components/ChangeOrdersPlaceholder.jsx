import { Box, Chip, Paper, Typography } from '@mui/material'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'

export default function ChangeOrdersPlaceholder() {
  return (
    <Paper variant="outlined" className="change-orders-placeholder activity-tone--change-order">
      <Box className="change-orders-placeholder__icon">
        <EventAvailableRoundedIcon />
      </Box>
      <Chip size="small" label="PENDING" color="success" variant="outlined" />
      <Typography variant="h5" fontWeight={800}>Extra / Change Orders</Typography>
      <Typography color="text.secondary" align="center">
        This workspace is reserved for extra work and change orders. Its events will use green when scheduling is enabled.
      </Typography>
      <Box className="change-orders-placeholder__legend">
        <span />
        Extra / Change Order event
      </Box>
    </Paper>
  )
}
