import { useState } from 'react'
import { NavLink } from 'react-router-dom'
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
} from '@mui/material'
//Icons
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import DonutSmallRoundedIcon from '@mui/icons-material/DonutSmallRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded'
import DomainRoundedIcon from '@mui/icons-material/DomainRounded'
import AddIcon from '@mui/icons-material/Add'
import KeyboardOptionKeyIcon from '@mui/icons-material/KeyboardOptionKey'
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
      { label: 'Jobs', path: '/jobs', icon: FolderRoundedIcon },
      { label: 'Sequence Sheets', icon: TableChartRoundedIcon },
      { label: 'Field Completion', icon: CheckCircleIcon },
    ],
  },
  {
    label: 'CUSTOMER SERVICE',
    items: [
      { label: 'Customer Service', icon: SupportAgentIcon }
    ]
  },
  {
    label: 'BILLING',
    items: [
      { label: 'Ready to Invoice', icon: RequestQuoteIcon },
      { label: 'Draw & Invoice Packages', icon: BallotIcon },
      { label: 'Invoices & A/R', icon: DescriptionIcon },
      { label: 'Releases', icon: DescriptionIcon },
      { label: 'Change Orders', icon:  SyncAltIcon },
    ],
  },
  {
    label: 'PRICING',
    items: [
      { label: 'Proposals', icon: DescriptionIcon },
      { label: 'Plan Pricing - Pricing Options', icon: SellIcon },
      { label: 'Draw Schedules', path: '/draw', icon: DonutSmallRoundedIcon },
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
      { label: 'Builders', path: '/builders', icon: BusinessRoundedIcon },
      { label: 'Crews Foremen', path: '/people', icon: PeopleAltRoundedIcon },
      { label: 'Plan Types', path: '/plan-types', icon: MapRoundedIcon },
      {
        label: 'Builder Types',
        icon: ApartmentRoundedIcon,
        children: [
          { label: 'Single Family', icon: HomeWorkRoundedIcon },
          { label: 'Multi Family', icon: DomainRoundedIcon },
        ],
      },
      { label: 'Options' , icon: KeyboardOptionKeyIcon },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { label: 'Users & Roles', icon: ManageAccountsRoundedIcon },
      { label: 'Configuration', icon: SettingsRoundedIcon },
    ],
  },
]

function NavigationItem({ label, path, icon: Icon, nested = false }) {
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
          pl: nested ? 4.5 : 2,
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
        <ListItemIcon sx={{ minWidth: nested ? 32 : 36, color: 'inherit' }}>
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

function ExpandableNavigationItem({ label, icon: Icon, children }) {
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
            <NavigationItem key={item.label} {...item} nested />
          ))}
        </List>
      </Collapse>
    </Box>
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

      <Box sx={{ px: 1.5, pb: 1 }}>
        <Button
          component={NavLink}
          startIcon={<AddIcon />}
          to="/jobs?create=1"
          variant="contained"
          color="primary"
          fullWidth
          sx={{ fontSize: 14, fontWeight: 600, textTransform: 'none' }}
        >
          Create
        </Button>
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
                item.children ? (
                  <ExpandableNavigationItem key={item.label} {...item} />
                ) : (
                  <NavigationItem key={item.label} {...item} />
                )
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
