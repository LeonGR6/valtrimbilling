import { Box, IconButton, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'

export default function DrawerHeader({ eyebrow, title, onClose }) {
  return (
    <Box className="activity-drawer__header">
      <Box>
        <Typography variant="overline" color="text.secondary" fontWeight={750}>{eyebrow}</Typography>
        <Typography variant="h5" fontWeight={780} letterSpacing="-0.02em">{title}</Typography>
      </Box>
      <IconButton onClick={onClose} aria-label="Close drawer" size="small">
        <CloseRoundedIcon />
      </IconButton>
    </Box>
  )
}
