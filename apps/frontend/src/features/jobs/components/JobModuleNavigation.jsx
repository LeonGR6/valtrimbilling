import { Box, Button, Tab, Tabs } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import { Link as RouterLink } from 'react-router-dom'
import { useAuth } from '../../auth/context/useAuth.js'
import { canOpenBuilderJobs, jobModulesForRole } from '../utils/jobModules.js'
import { builderJobsPath } from '../utils/jobRoutes.js'

const moduleIcons = {
  'plans-options': <FormatListBulletedRoundedIcon fontSize="small" />,
  'sequence-sheet': <TableChartRoundedIcon fontSize="small" />,
  'plan-pricing': <AttachMoneyRoundedIcon fontSize="small" />,
  'draw-invoice': <ReceiptLongRoundedIcon fontSize="small" />,
}

export default function JobModuleNavigation({ active, builderId, jobId, showBack = true }) {
  const { profile } = useAuth()

  if (builderId == null || jobId == null) return null

  // Each role sees the pages of the Job it can open, and the way back only if it can open the list.
  const modules = jobModulesForRole(profile?.role)
  const backAllowed = showBack && canOpenBuilderJobs(profile?.role)

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
      {backAllowed && (
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
        sx={{ minHeight: 44, minWidth: 0, flex: 1, ml: backAllowed ? 0 : -1.5 }}
      >
        {modules.map((module) => (
          <Tab
            key={module.id}
            value={module.id}
            component={RouterLink}
            to={module.path(builderId, jobId)}
            role="link"
            icon={moduleIcons[module.id]}
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
