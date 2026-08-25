import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppBar, Box, IconButton, Toolbar, Typography } from '@mui/material'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import Sidebar from '../Sidebar'
import { navigationRoutes } from '../../../routes/navigation.jsx'

// On mobile the sidebar is hidden, so the bar is the only thing telling the
// user which screen they are on.
function useCurrentRouteLabel() {
  const { pathname } = useLocation()

  return (
    navigationRoutes.find((route) =>
      route.path === '/' ? pathname === '/' : pathname.startsWith(route.path),
    )?.label ?? 'ValtrimBilling'
  )
}

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const routeLabel = useCurrentRouteLabel()

  return (
    <Box
      sx={{
        display: 'flex',
        // dvh keeps the layout from hiding behind the mobile browser chrome.
        height: ['100vh', '100dvh'],
        bgcolor: 'background.default',
      }}
    >
      <AppBar
        position="fixed"
        elevation={0}
        color="inherit"
        sx={{
          display: { xs: 'block', md: 'none' },
          bgcolor: 'sidebar.bg',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar variant="dense">
          <IconButton
            edge="start"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 1.5 }}
          >
            <MenuRoundedIcon />
          </IconButton>
          <Typography noWrap sx={{ fontWeight: 600, color: 'text.primary' }}>
            {routeLabel}
          </Typography>
        </Toolbar>
      </AppBar>

      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Spacer matching the fixed AppBar, mobile only. */}
        <Toolbar variant="dense" sx={{ display: { xs: 'block', md: 'none' } }} />
        <Box
          sx={{
            flexGrow: 1,
            minHeight: 0,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
