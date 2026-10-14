import { Box, Button, Tab, Tabs } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import { Link as RouterLink } from 'react-router-dom'
import {
  builderJobsPath,
  jobDrawInvoicePath,
  jobPlanPricingPath,
  jobPlansOptionsPath,
  jobSequenceSheetPath,
} from '../utils/jobRoutes.js'

const modules = [
  {
    id: 'plans-options',
    label: 'Plans & Options',
    icon: <FormatListBulletedRoundedIcon fontSize="small" />,
    path: jobPlansOptionsPath,
  },
  {
    id: 'sequence-sheet',
    label: 'Sequence Sheet',
    icon: <TableChartRoundedIcon fontSize="small" />,
    path: jobSequenceSheetPath,
  },
  {
    id: 'plan-pricing',
    label: 'Plan Pricing',
    icon: <AttachMoneyRoundedIcon fontSize="small" />,
    path: jobPlanPricingPath,
  },
  {
    id: 'draw-invoice',
    label: 'Draws',
    icon: <ReceiptLongRoundedIcon fontSize="small" />,
    path: jobDrawInvoicePath,
  },
]

export default function JobModuleNavigation({ active, builderId, jobId, showBack = true }) {
  if (builderId == null || jobId == null) return null

  return (
    <Box
      component="nav"
      aria-label="Job sections"
      sx={{
        px: { xs: 2.5, md: 4 },
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 2,
      }}
    >
      {showBack && (
        <Button
          component={RouterLink}
          to={builderJobsPath(builderId)}
          color="inherit"
          size="small"
          startIcon={<ArrowBackRoundedIcon />}
          sx={{ color: 'text.secondary', my: 0.5 }}
        >
          Builder jobs
        </Button>
      )}

      <Tabs
        value={modules.some((module) => module.id === active) ? active : false}
        variant="scrollable"
        scrollButtons="auto"
        role="navigation"
        aria-label="Job modules"
        sx={{ minHeight: 44, minWidth: 0, flex: 1, ml: showBack ? 0 : -1.5 }}
      >
        {modules.map((module) => (
          <Tab
            key={module.id}
            value={module.id}
            component={RouterLink}
            to={module.path(builderId, jobId)}
            role="link"
            icon={module.icon}
            iconPosition="start"
            label={module.label}
            aria-current={module.id === active ? 'page' : undefined}
            sx={{
              minHeight: 44,
              minWidth: 0,
              py: 0,
              px: 1.5,
              textTransform: 'none',
              fontWeight: 600,
            }}
          />
        ))}
      </Tabs>
    </Box>
  )
}
