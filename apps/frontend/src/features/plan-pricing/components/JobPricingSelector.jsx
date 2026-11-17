import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Skeleton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { getJobBuilderId, jobPlanPricingPath } from '../../jobs/utils/jobRoutes.js'
import { getJobPricingStatus } from '../utils/jobPricingStatus.js'

function PricingMeter({ status }) {
  if (status.total === 0) {
    return <Typography variant="body2" color="text.secondary">No plans yet</Typography>
  }

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        {status.complete && (
          <CheckCircleRoundedIcon sx={{ fontSize: 18, color: 'success.main' }} aria-hidden="true" />
        )}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {status.complete
            ? 'All prices set'
            : `${status.priced} of ${status.total} prices set`}
        </Typography>
        {!status.complete && (
          <Typography variant="caption" sx={{ color: 'urgency.soon', fontWeight: 600 }}>
            {status.missing} missing
          </Typography>
        )}
      </Box>
      <LinearProgress
        variant="determinate"
        value={status.percent}
        color={status.complete ? 'success' : 'primary'}
        aria-label="Prices set"
        sx={{ height: 6, borderRadius: 3, bgcolor: 'divider' }}
      />
    </Box>
  )
}

function JobRow({ job, status }) {
  const builderId = getJobBuilderId(job)
  const linkProps = builderId == null
    ? {}
    : { component: RouterLink, to: jobPlanPricingPath(builderId, job.id) }

  return (
    <Box
      {...linkProps}
      aria-label={`Job ${job.code}, ${job.builder}, ${job.community}. Open plan pricing`}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1.2fr) minmax(220px, 0.8fr) auto' },
        alignItems: 'center',
        columnGap: 3,
        rowGap: 1.25,
        px: { xs: 2, sm: 2.5 },
        py: 1.75,
        borderTop: 1,
        borderColor: 'divider',
        color: 'text.primary',
        textDecoration: 'none',
        '&:hover': { bgcolor: 'action.hover' },
        '&:hover .job-row-arrow': { transform: 'translateX(2px)', color: 'text.primary' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          <Typography component="span" sx={{ fontWeight: 600, fontSize: 16 }}>
            Job {job.code}
          </Typography>
          {job.isActive === false && (
            <Typography component="span" variant="caption" color="text.secondary">
              Inactive, read-only
            </Typography>
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" noWrap>
          {job.builder} · {job.community}
        </Typography>
      </Box>

      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, gridRow: { xs: 2, md: 'auto' } }}>
        <PricingMeter status={status} />
      </Box>

      <ChevronRightRoundedIcon
        className="job-row-arrow"
        aria-hidden="true"
        sx={{
          color: 'text.secondary',
          gridColumn: { xs: 2, md: 'auto' },
          gridRow: { xs: 1, md: 'auto' },
          '@media (prefers-reduced-motion: no-preference)': { transition: 'transform 150ms' },
        }}
      />
    </Box>
  )
}

/** The first screen of /pricing: which Job to price, and which still need it. */
export default function JobPricingSelector({ jobs, loading, error, onRetry }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const rows = useMemo(
    () => jobs.map((job) => ({ job, status: getJobPricingStatus(job) })),
    [jobs],
  )
  const needsPricing = rows.filter(({ status }) => status.missing > 0).length
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter(({ job, status }) => (
      (filter === 'all' || status.missing > 0)
      && (!query
        || [job.code, job.builder, job.community].join(' ').toLowerCase().includes(query))
    ))
  }, [rows, search, filter])

  return (
    <Box
      sx={{
        minHeight: '100%',
        bgcolor: 'background.default',
        '& .MuiButton-root': { textTransform: 'none' },
      }}
    >
      <Box sx={{ px: { xs: 2.5, md: 4 }, py: 3, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: '-0.015em' }}>
          Plan pricing
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Choose a Job to review and update the prices of its plans and options.
        </Typography>
      </Box>

      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
        {error && (
          <Alert
            severity="error"
            action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}
            sx={{ mb: 2.5 }}
          >
            {error}
          </Alert>
        )}

        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { sm: 'center' },
            gap: 1.5,
            mb: 2,
          }}
        >
          <TextField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Job, builder or community"
            fullWidth
            autoFocus
            size="small"
            sx={{ maxWidth: { sm: 520 } }}
            slotProps={{
              input: {
                startAdornment: <SearchRoundedIcon color="action" sx={{ mr: 1 }} />,
              },
              htmlInput: { 'aria-label': 'Search Jobs' },
            }}
          />
          <ToggleButtonGroup
            value={filter}
            exclusive
            size="small"
            aria-label="Filter Jobs"
            onChange={(_, value) => { if (value) setFilter(value) }}
            sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5 } }}
          >
            <ToggleButton value="all">All {rows.length}</ToggleButton>
            <ToggleButton value="needs">Needs pricing {needsPricing}</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          {loading ? (
            <Box sx={{ p: 2.5 }}>
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} variant="rounded" height={52} sx={{ mb: index === 2 ? 0 : 1.5 }} />
              ))}
            </Box>
          ) : visible.length > 0 ? (
            <Box component="nav" aria-label="Jobs" sx={{ '& > *:first-of-type': { borderTop: 0 } }}>
              {visible.map(({ job, status }) => (
                <JobRow key={job.id} job={job} status={status} />
              ))}
            </Box>
          ) : (
            <Box sx={{ py: 7, px: 3, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 600 }}>
                {jobs.length === 0
                  ? 'No Jobs available'
                  : filter === 'needs' && !search.trim()
                    ? 'Every Job has all its prices set'
                    : 'No Jobs match your search'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {jobs.length === 0
                  ? 'Create a Job and configure its plans before assigning prices.'
                  : filter === 'needs' && !search.trim()
                    ? 'Switch to All to see every Job.'
                    : 'Try another Job number, builder or community.'}
              </Typography>
              {jobs.length === 0 && (
                <Button component={RouterLink} to="/jobs" variant="outlined" sx={{ mt: 2 }}>
                  Go to Jobs
                </Button>
              )}
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  )
}
