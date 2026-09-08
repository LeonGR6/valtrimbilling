import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import {
  Drawer,
  Box,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Typography,
  Divider,
  Chip,
  Collapse,
  IconButton,
  Tooltip,
} from '@mui/material'
//Icons
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import DonutSmallRoundedIcon from '@mui/icons-material/DonutSmallRounded'
import ContactPhoneRoundedIcon from '@mui/icons-material/ContactPhoneRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded'
import DomainRoundedIcon from '@mui/icons-material/DomainRounded'
import AddIcon from '@mui/icons-material/Add'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import BallotIcon from '@mui/icons-material/Ballot';
import DescriptionIcon from '@mui/icons-material/Description';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import SellIcon from '@mui/icons-material/Sell';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BarChartIcon from '@mui/icons-material/BarChart'
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'

import valtrimLogoDark from '../../../assets/icons/Valtrim-White-Transparent.png'
import valtrimLogoLight from '../../../assets/icons/Valtrim-Blue-Transparent.png'
import { navigationRoutes } from '../../../routes/navigation.jsx'
import ColorModeToggle from '../../common/ColorModeToggle'
import { useAuth } from '../../../features/auth/useAuth.js'

const DRAWER_WIDTH = 256
const RAIL_WIDTH = 72
const COLLAPSED_KEY = 'valtrim.sidebar.collapsed'
const availablePaths = new Set(navigationRoutes.map(({ path }) => path))

const homeItem = { label: 'Home', path: '/', icon: HomeRoundedIcon }

const navigationSections = [
  {
    label: 'OPERATION',
    items: [
      { label: 'Calendar', path: '/calendar', icon: CalendarMonthRoundedIcon },
      { label: 'Jobs', path: '/jobs', icon: FolderRoundedIcon },
      { label: 'Sequence Sheets', path: '/sequence-sheets', icon: TableChartRoundedIcon },
      { label: 'Field Completion', icon: CheckCircleIcon },
    ],
  },
  {
    label: 'CUSTOMER SERVICE',
    items: [
      { label: 'Customer Service', path: '/customer-service', icon: SupportAgentIcon }
    ]
  },
  {
    label: 'BILLING',
    items: [
      { label: 'Ready to Invoice', icon: RequestQuoteIcon },
      { label: 'Draw & Invoice Packages', path: '/draw-invoice', icon: BallotIcon },
      { label: 'Invoices & A/R', icon: DescriptionIcon },
      { label: 'Releases', icon: DescriptionIcon },
      { label: 'Release - Builder Portal', icon: DescriptionIcon },
      { label: 'Extra / Change Orders', icon:  SyncAltIcon },
    ],
  },
  {
    label: 'PRICING',
    items: [
      { label: 'Proposals', icon: DescriptionIcon },
      { label: 'Plan Pricing - Pricing Options', path: '/pricing', icon: SellIcon },
      {
        label: 'Builder Draw Schedules',
        path: '/builder-draw-schedules',
        icon: DonutSmallRoundedIcon,
      },
    ]
  },
  {
    label: 'REPORTING',
    items: [
      { label: 'Reports', icon: BarChartIcon },
    ]
  },
  {
    label: 'CATALOGS',
    items: [
      { label: 'Crews & Foremen', path: '/people', icon: PeopleAltRoundedIcon },
      { label: 'Builder Contacts', path: '/builder-contacts', icon: ContactPhoneRoundedIcon },
      {
        label: 'Builder Types',
        icon: ApartmentRoundedIcon,
        children: [
          { label: 'Single Family', icon: HomeWorkRoundedIcon },
          { label: 'Multi Family', icon: DomainRoundedIcon },
        ],
      },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { label: 'Users & Roles', path: '/users', icon: ManageAccountsRoundedIcon },
      { label: 'Configuration', icon: SettingsRoundedIcon },
    ],
  },
]

function NavigationItem({ label, path, icon: Icon, nested = false, onNavigate, collapsed }) {
  const isAvailable = Boolean(path && availablePaths.has(path))

  // A grey icon with no label explains nothing, so unbuilt screens step out of
  // the rail entirely and come back when it expands.
  if (collapsed && !isAvailable) return null

  return (
    <Tooltip title={collapsed ? label : ''} placement="right">
      <ListItem disablePadding sx={{ mb: 0.25 }}>
      <ListItemButton
        {...(isAvailable
          ? { component: NavLink, to: path, end: path === '/', onClick: onNavigate }
          : { component: 'div' })}
        disabled={!isAvailable}
        sx={{
          minHeight: 40,
          pl: collapsed ? 0 : nested ? 4.5 : 2,
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRadius: 2,
          color: 'text.secondary',
          '&:hover': { bgcolor: 'sidebar.hover' },
          '&.active': {
            bgcolor: 'sidebar.hover',
            color: 'text.primary',
            '& .MuiListItemIcon-root': { color: 'primary.main' },
            '& .MuiListItemText-primary': { fontWeight: 600 },
          },
          '&.Mui-disabled': { opacity: 0.55 },
        }}
      >
        <ListItemIcon
          sx={{ minWidth: collapsed ? 0 : nested ? 32 : 36, color: 'inherit' }}
        >
          <Icon fontSize="small" />
        </ListItemIcon>
        {!collapsed && (
          <ListItemText
            primary={label}
            sx={{ '& .MuiListItemText-primary': { fontSize: 14 } }}
          />
        )}
        {!collapsed && !isAvailable && (
          <Chip
            label="Soon"
            size="small"
            variant="outlined"
            sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
          />
        )}
        </ListItemButton>
      </ListItem>
    </Tooltip>
  )
}

function ExpandableNavigationItem({ label, icon: Icon, children, onNavigate }) {
  const [open, setOpen] = useState(false)
  const submenuId = `${label.toLowerCase().replaceAll(' ', '-')}-submenu`

  return (
    <Box component="li" sx={{ listStyle: 'none', mb: 0.25 }}>
      <ListItemButton
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={submenuId}
        sx={{
          minHeight: 40,
          borderRadius: 2,
          color: 'text.secondary',
          '&:hover': { bgcolor: 'sidebar.hover' },
          ...(open && {
            bgcolor: 'sidebar.hover',
            color: 'text.primary',
            '& .MuiListItemIcon-root': { color: 'primary.main' },
            '& .MuiListItemText-primary': { fontWeight: 600 },
          }),
        }}
      >
        <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>
          <Icon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary={label}
          sx={{ '& .MuiListItemText-primary': { fontSize: 14 } }}
        />
        {open ? (
          <KeyboardArrowUpIcon fontSize="small" />
        ) : (
          <KeyboardArrowDownIcon fontSize="small" />
        )}
      </ListItemButton>

      <Collapse in={open} timeout="auto" unmountOnExit>
        <List id={submenuId} disablePadding>
          {children.map((item) => (
            <NavigationItem key={item.label} {...item} nested onNavigate={onNavigate} />
          ))}
        </List>
      </Collapse>
    </Box>
  )
}

// A hairline scrollbar: enough to show there is more below, quiet enough not
// to compete with the navigation itself.
//
// Chromium ignores ::-webkit-scrollbar as soon as either standard property is
// set, so the standard ones are scoped to browsers without the webkit selector.
const thinScrollSx = (theme) => ({
  '&::-webkit-scrollbar': { width: 6 },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: theme.palette.divider,
    borderRadius: '3px',
  },
  '&:hover::-webkit-scrollbar-thumb': {
    backgroundColor: theme.palette.text.secondary,
  },
  '@supports not selector(::-webkit-scrollbar)': {
    scrollbarWidth: 'thin',
    scrollbarColor: `${theme.palette.divider} transparent`,
  },
})

// Animating a 184px panel is exactly what this preference exists to avoid, and
// MUI does not opt out on its own.
const widthTransition = (theme) => ({
  transition: theme.transitions.create('width', {
    duration: theme.transitions.duration.shorter,
  }),
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
})

const paperSx = (width) => (theme) => ({
  width,
  boxSizing: 'border-box',
  bgcolor: 'sidebar.bg',
  borderRight: 'none',
  display: 'flex',
  flexDirection: 'column',
  // Labels would spill during the width transition.
  overflowX: 'hidden',
  ...widthTransition(theme),
})

// Same two files and the same mode check the login screen uses, so the mark is
// consistent across the app.
function BrandLogo({ height }) {
  const theme = useTheme()
  const logo = theme.palette.mode === 'dark' ? valtrimLogoDark : valtrimLogoLight

  return (
    <Box
      component="img"
      src={logo}
      alt="Valtrim"
      sx={{ height, width: 'auto', display: 'block' }}
    />
  )
}

const sectionHeadingId = (label) =>
  `sidebar-section-${label.toLowerCase().replaceAll(' ', '-')}`

// A section is worth a heading only if something inside it can be opened.
function hasAvailableItem(section) {
  return section.items.some((item) => item.path && availablePaths.has(item.path))
}

function SidebarContent({ onNavigate, collapsed = false, onToggleCollapsed }) {
  const { user, signOut } = useAuth()
  const email = user?.email ?? ''
  const name = user?.user_metadata?.name?.trim() || email.split('@')[0] || 'User'
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          flexDirection: collapsed ? 'column' : 'row',
          gap: collapsed ? 0.5 : 1.5,
          p: 1.5,
          pb: 1,
        }}
      >
        <BrandLogo height={collapsed ? 26 : 30} />
        {!collapsed && (
          <Typography sx={{ flexGrow: 1, fontWeight: 600, color: 'text.primary' }}>
            ValtrimBilling
          </Typography>
        )}
        {onToggleCollapsed && (
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
            <IconButton
              size="small"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={onToggleCollapsed}
              sx={{ color: 'text.secondary' }}
            >
              {collapsed ? <ChevronRightRoundedIcon /> : <ChevronLeftRoundedIcon />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ px: 1.5, pb: 1, display: 'flex', justifyContent: 'center' }}>
        <Tooltip title={collapsed ? 'Create' : ''} placement="right">
          <Button
            component={NavLink}
            startIcon={collapsed ? null : <AddIcon />}
            to="/jobs?create=1"
            onClick={onNavigate}
            variant="contained"
            color="primary"
            fullWidth={!collapsed}
            aria-label="Create"
            sx={{
              fontSize: 14,
              fontWeight: 600,
              textTransform: 'none',
              ...(collapsed && { minWidth: 40, width: 40, height: 40, p: 0 }),
            }}
          >
            {collapsed ? <AddIcon /> : 'Create'}
          </Button>
        </Tooltip>
      </Box>

      {/* Navigation is organized by workflow; future modules stay visible but disabled. */}
      <Box
        component="nav"
        aria-label="Main navigation"
        sx={[
          { flexGrow: 1, overflowY: 'auto', px: 1, pb: 2 },
          thinScrollSx,
        ]}
      >
        <List disablePadding>
        <NavigationItem {...homeItem} onNavigate={onNavigate} collapsed={collapsed} />

        {navigationSections
          .filter((section) => !collapsed || hasAvailableItem(section))
          .map((section) => (
            <Box component="li" key={section.label} sx={{ listStyle: 'none', mt: 1.5 }}>
              {collapsed ? (
                <Divider sx={{ mx: 1, mb: 0.5 }} />
              ) : (
                <Typography
                  component="h2"
                  id={sectionHeadingId(section.label)}
                  sx={{ px: 1.5, mb: 0.5, color: 'text.secondary', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}
                >
                  {section.label}
                </Typography>
              )}
              <List
                disablePadding
                {...(collapsed
                  ? { 'aria-label': section.label }
                  : { 'aria-labelledby': sectionHeadingId(section.label) })}
              >
                {section.items.map((item) => (
                  item.children ? (
                    // Submenus cannot open inside a 72px rail, so they wait.
                    collapsed ? null : (
                      <ExpandableNavigationItem key={item.label} {...item} onNavigate={onNavigate} />
                    )
                  ) : (
                    <NavigationItem
                      key={item.label}
                      {...item}
                      onNavigate={onNavigate}
                      collapsed={collapsed}
                    />
                  )
                ))}
              </List>
            </Box>
          ))}
        </List>
      </Box>

      {/* Authenticated user + session controls. */}
      <Divider />
      <Box
        sx={{
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: collapsed ? 1 : 0.5,
          flexDirection: collapsed ? 'column' : 'row',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1, minWidth: 0 }}>
          <Tooltip title={collapsed ? email : ''} placement="right">
            <Avatar
              sx={{ bgcolor: 'primary.light', color: 'primary.main', width: 32, height: 32, fontSize: 14, fontWeight: 600 }}
            >
              {initials}
            </Avatar>
          </Tooltip>
          {!collapsed && (
            <>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography noWrap sx={{ fontSize: 14, fontWeight: 500, color: 'text.primary' }}>
                  {name}
                </Typography>
                <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {email}
                </Typography>
              </Box>
            </>
          )}
        </Box>
        <ColorModeToggle />
        <Tooltip title="Sign out">
          <IconButton
            size="small"
            aria-label="Sign out"
            onClick={async () => {
              await signOut()
              onNavigate?.()
            }}
            sx={{ color: 'text.secondary' }}
          >
            <LogoutRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </>
  )
}

// Two drawers: an overlay below `md`, the collapsible rail above it.
export default function Sidebar({ mobileOpen = false, onMobileClose }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === '1',
  )

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const railWidth = collapsed ? RAIL_WIDTH : DRAWER_WIDTH

  return (
    <>
      {/* The overlay always shows full labels: a rail on a phone helps nobody. */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': paperSx(DRAWER_WIDTH),
        }}
      >
        <SidebarContent onNavigate={onMobileClose} />
      </Drawer>

      <Drawer
        variant="permanent"
        sx={(theme) => ({
          display: { xs: 'none', md: 'block' },
          width: railWidth,
          flexShrink: 0,
          ...widthTransition(theme),
          '& .MuiDrawer-paper': paperSx(railWidth),
        })}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((current) => !current)}
        />
      </Drawer>
    </>
  )
}
