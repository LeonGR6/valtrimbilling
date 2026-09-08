import { Alert, Box, Button, CircularProgress, Stack } from '@mui/material'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth.js'

export default function RequireAuth({ children }) {
  const location = useLocation()
  const { configured, error, loading, profile, session, signOut } = useAuth()

  if (!configured) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Alert severity="error" sx={{ maxWidth: 720 }}>
          Supabase is not configured. Copy apps/frontend/.env.example to
          apps/frontend/.env and add this project's URL and publishable key.
        </Alert>
      </Box>
    )
  }

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading session" />
      </Box>
    )
  }

  if (!session) {
    const from = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from }} />
  }

  if (!profile) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Stack spacing={2} sx={{ width: '100%', maxWidth: 720 }}>
          <Alert severity="error">
            {error ?? 'Your ValtrimBilling profile could not be loaded.'}
          </Alert>
          <Button variant="outlined" onClick={() => signOut()}>
            Return to sign in
          </Button>
        </Stack>
      </Box>
    )
  }

  return children
}
