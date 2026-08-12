import { useRouteError, isRouteErrorResponse, Link as RouterLink } from 'react-router-dom'
import { Box, Typography, Link } from '@mui/material'

export default function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error?.message || 'Unexpected error'

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 1,
        p: 2,
        textAlign: 'center',
      }}
    >
      <Typography variant="h5" fontWeight={600}>
        Something went wrong
      </Typography>
      <Typography color="text.secondary">{message}</Typography>
      <Link component={RouterLink} to="/" underline="hover">
        Go home
      </Link>
    </Box>
  )
}
