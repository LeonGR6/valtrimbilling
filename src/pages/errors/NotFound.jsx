import { Link as RouterLink } from 'react-router-dom'
import { Box, Typography, Link } from '@mui/material'

export default function NotFound() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 1,
      }}
    >
      <Typography variant="h5" fontWeight={600}>
        404 — Page not found
      </Typography>
      <Link component={RouterLink} to="/" underline="hover">
        Go home
      </Link>
    </Box>
  )
}
