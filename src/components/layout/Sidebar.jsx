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
} from '@mui/material'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import BrushIcon from '@mui/icons-material/Brush'
import GroupsIcon from '@mui/icons-material/Groups'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import BarChartIcon from '@mui/icons-material/BarChart'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import { routes } from '../../routes/nav.jsx'
import ColorModeToggle from '../ui/ColorModeToggle'

const icons = {
  calendar: CalendarMonthIcon,
  draw: BrushIcon,
  builders: GroupsIcon,
  pricing: LocalOfferIcon,
  invoice: ReceiptLongIcon,
  financials: BarChartIcon,
}

const DRAWER_WIDTH = 256

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

      {/* Main navigation */}
      <List sx={{ flexGrow: 1, overflowY: 'auto', px: 1 }}>
        {routes.map(({ path, label, icon }) => {
          const IconComp = icons[icon] ?? RadioButtonUncheckedIcon
          return (
            <ListItem key={path} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                component={NavLink}
                to={path}
                sx={{
                  borderRadius: 2,
                  color: 'text.secondary',
                  '&:hover': { bgcolor: 'sidebar.hover' },
                  '&.active': {
                    bgcolor: 'sidebar.hover',
                    color: 'text.primary',
                    '& .MuiListItemIcon-root': { color: 'text.primary' },
                    '& .MuiListItemText-primary': { fontWeight: 600 },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>
                  <IconComp fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={label}
                  sx={{ '& .MuiListItemText-primary': { fontSize: 14 } }}
                />
              </ListItemButton>
            </ListItem>
          )
        })}
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
              user@valtrim.com
            </Typography>
          </Box>
          <KeyboardArrowUpIcon sx={{ color: 'text.secondary' }} />
        </Box>
        <ColorModeToggle />
      </Box>
    </Drawer>
  )
}
