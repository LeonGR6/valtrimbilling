import { Alert, AlertTitle, Box } from '@mui/material'
import { useAuth } from './useAuth.js'
import { isRoleAllowed } from '../authorization/roleAccess.js'

export default function RequireRole({ allowedRoles, children }) {
  const { profile } = useAuth()

  if (isRoleAllowed(profile?.role, allowedRoles)) return children

  return (
    <Box sx={{ p: { xs: 2.5, md: 4 } }}>
      <Alert severity="error" variant="outlined">
        <AlertTitle>Access denied</AlertTitle>
        Your account does not have permission to manage users and roles.
      </Alert>
    </Box>
  )
}
