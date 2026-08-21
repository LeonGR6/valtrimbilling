import { Box, Button, Stack } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import { Link as RouterLink } from 'react-router-dom'
import {
  builderJobsPath,
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
]

export default function JobModuleNavigation({ active, builderId, jobId }) {
  if (builderId == null || jobId == null) return null

  return (
    <Box
      component="nav"
      aria-label="Job sections"
      sx={{
        px: { xs: 2.5, md: 4 },
        py: 1.5,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={1.25}
        sx={{ alignItems: { lg: 'center' }, justifyContent: 'space-between' }}
      >
        <Button
          component={RouterLink}
          to={builderJobsPath(builderId)}
          color="inherit"
          size="small"
          startIcon={<ArrowBackRoundedIcon />}
          sx={{ alignSelf: { xs: 'flex-start', lg: 'auto' } }}
        >
          Builder jobs
        </Button>

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {modules.map((module) => {
            const selected = module.id === active

            return (
              <Button
                key={module.id}
                component={RouterLink}
                to={module.path(builderId, jobId)}
                size="small"
                variant={selected ? 'contained' : 'outlined'}
                color={selected ? 'primary' : 'inherit'}
                startIcon={module.icon}
                aria-current={selected ? 'page' : undefined}
                disableElevation
              >
                {module.label}
              </Button>
            )
          })}
        </Stack>
      </Stack>
    </Box>
  )
}
