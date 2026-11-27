import { useState } from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import PeopleCatalog from '../../features/people'
import { useAuth } from '../../features/auth/context/useAuth.js'
import TechniciansCatalog from '../../features/customer-service/components/TechniciansCatalog.jsx'

export default function PeoplePage() {
  const { profile } = useAuth()
  const [view, setView] = useState('SUPERVISORS')
  const canAccessTechnicians = ['ADMIN', 'SCHEDULING'].includes(profile?.role)

  return (
    <Box>
      {canAccessTechnicians && (
        <Box sx={{ px: { xs: 2.5, md: 4 }, pt: 2, bgcolor: 'background.paper' }}>
          <Tabs value={view} onChange={(_, value) => setView(value)}
            variant="scrollable" scrollButtons="auto" aria-label="Crews and Foremen rosters">
            <Tab value="SUPERVISORS" label="Supervisors" />
            <Tab value="TECHNICIANS" label="Service technicians" />
          </Tabs>
        </Box>
      )}
      {view === 'TECHNICIANS' && canAccessTechnicians
        ? <Box sx={{ p: { xs: 2.5, md: 4 } }}><TechniciansCatalog /></Box>
        : <PeopleCatalog />}
    </Box>
  )
}
