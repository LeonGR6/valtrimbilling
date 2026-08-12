import { NavLink } from 'react-router-dom'
import {
  Drawer,
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Typography,
  Divider,
  Chip,
} from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import DonutSmallRoundedIcon from '@mui/icons-material/DonutSmallRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import HandymanRoundedIcon from '@mui/icons-material/HandymanRounded'
import KeyboardOptionKeyIcon from '@mui/icons-material/KeyboardOptionKey'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import { navigationRoutes } from '../../../routes/navigation.jsx'
import ColorModeToggle from '../../common/ColorModeToggle'

const DRAWER_WIDTH = 256
const availablePaths = new Set(navigationRoutes.map(({ path }) => path))

const homeItem = { label: 'Home', path: '/', icon: HomeRoundedIcon }

const navigationSections = [
  {
    label: 'OPERATION',
    items: [
      { label: 'Calendar', path: '/calendar', icon: CalendarMonthRoundedIcon },
      { label: 'Projects', icon: FolderRoundedIcon },
      { label: 'Sequence Sheets', icon: TableChartRoundedIcon },
    ],
  },
  {
    label: 'CATALOGS',
    items: [
      { label: 'Draw Schedules', path: '/draw', icon: DonutSmallRoundedIcon },
      { label: 'Builders', path: '/builders', icon: BusinessRoundedIcon },
      { label: 'Plan Types', path: '/plan-types', icon: MapRoundedIcon },
      { label: 'Builder Types', icon: ApartmentRoundedIcon },
      { label: 'Options' , icon: KeyboardOptionKeyIcon },
      { label: 'Work Codes', icon: HandymanRoundedIcon },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { label: 'Users', icon: ManageAccountsRoundedIcon },
      { label: 'Configuration', icon: SettingsRoundedIcon },
    ],
  },
]

function NavigationItem({ label, path, icon: Icon }) {
  const isAvailable = Boolean(path && availablePaths.has(path))

  return (
    <ListItem disablePadding sx={{ mb: 0.25 }}>
      <ListItemButton
        {...(isAvailable
          ? { component: NavLink, to: path, end: path === '/' }
          : { component: 'div' })}
        disabled={!isAvailable}
        sx={{
          minHeight: 40,
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
        <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>
          <Icon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary={label}
          sx={{ '& .MuiListItemText-primary': { fontSize: 14 } }}
        />
        {!isAvailable && (
          <Chip
            label="Soon"
            size="small"
            variant="outlined"
            sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
          />
        )}
      </ListItemButton>
    </ListItem>
  )
}

export default function Sidebar() {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
          bgcolor: 'sidebar.bg',
          borderRight: 'none',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Brand / workspace (static placeholder until a menu is wired) */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, pb: 1 }}>
        <Avatar
          variant="rounded"
          sx={{ bgcolor: 'primary.main', width: 32, height: 32, fontSize: 14, fontWeight: 700 }}
        >
          V
        </Avatar>
        <Typography sx={{ flexGrow: 1, fontWeight: 600, color: 'text.primary' }}>
          ValtrimBilling
        </Typography>
        <KeyboardArrowDownIcon sx={{ color: 'text.secondary' }} />
      </Box>

      {/* Navigation is organized by workflow; future modules stay visible but disabled. */}
      <List sx={{ flexGrow: 1, overflowY: 'auto', px: 1, pb: 2 }}>
        <NavigationItem {...homeItem} />

        {navigationSections.map((section) => (
          <Box component="li" key={section.label} sx={{ listStyle: 'none', mt: 1.5 }}>
            <Typography
              component="div"
              sx={{ px: 1.5, mb: 0.5, color: 'text.secondary', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}
            >
              {section.label}
            </Typography>
            <List disablePadding>
              {section.items.map((item) => (
                <NavigationItem key={item.label} {...item} />
              ))}
            </List>
          </Box>
        ))}
      </List>

      {/* User profile (static placeholder) + theme toggle */}
      <Divider />
      <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1, minWidth: 0 }}>
          <Avatar
            sx={{ bgcolor: 'primary.light', color: 'primary.main', width: 32, height: 32, fontSize: 14, fontWeight: 600 }}
          >
            U
          </Avatar>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography noWrap sx={{ fontSize: 14, fontWeight: 500, color: 'text.primary' }}>
              User
            </Typography>
            <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>
              user@valtriminc.com
            </Typography>
          </Box>
          <KeyboardArrowUpIcon sx={{ color: 'text.secondary' }} />
        </Box>
        <ColorModeToggle />
      </Box>
    </Drawer>
  )
}
