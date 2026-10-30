import { useMemo, useState } from 'react'
import { Alert, Box, Button, Paper, Skeleton, Stack, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { useBuilderDrawSchedules } from '../../features/builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { useProductionActivities } from '../../features/calendar/context/useProductionActivities.js'
import { usePhaseCalendarCoverage } from '../../features/calendar/hooks/usePhaseCalendarCoverage.js'
import CollectionSummary from '../../features/dashboard/components/CollectionSummary.jsx'
import NeedsActionQueue from '../../features/dashboard/components/NeedsActionQueue.jsx'
import PackagePipeline from '../../features/dashboard/components/PackagePipeline.jsx'
import ProductionSchedule from '../../features/dashboard/components/ProductionSchedule.jsx'
import { buildActionQueue, summarizeActionQueue } from '../../features/dashboard/utils/actionQueue.js'
import { formatFullDay, pluralize } from '../../features/dashboard/utils/dashboardDates.js'
import { buildDashboardMetrics } from '../../features/dashboard/utils/dashboardMetrics.js'
import { useDrawInvoicePackages } from '../../features/draw-invoice/context/useDrawInvoicePackages.js'
import {
  buildUpcomingCutoffSuggestions,
} from '../../features/draw-invoice/utils/packageSuggestions.js'
import { useJobs } from '../../features/jobs/context/useJobs.js'
import { useCurrentDate } from '../../hooks/useCurrentDate.js'

function actionSummary({ cutoffs, overdueInvoices, phases }) {
  const parts = [
    cutoffs > 0 && `${pluralize(cutoffs, 'cutoff')} to bill`,
    overdueInvoices > 0 && `${pluralize(overdueInvoices, 'invoice')} overdue`,
    phases > 0 && `${pluralize(phases, 'Phase')} without Calendar events`,
  ].filter(Boolean)

  if (parts.length === 0) return 'Nothing needs action today.'
  if (parts.length === 1) return `${parts[0]}.`
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`
}

export default function HomePage() {
  const [days, setDays] = useState(7)
  const [now, refreshNow] = useCurrentDate()
  const {
    activities: productionActivities,
    events,
    loading: productionLoading,
    error: productionError,
    refreshProductionActivities,
  } = useProductionActivities()
  const {
    drawInvoicePackages, loading: packagesLoading, error: packagesError, refreshDrawInvoicePackages,
  } = useDrawInvoicePackages()
  const { jobs, loading: jobsLoading, error: jobsError, refreshJobs } = useJobs()
  const phaseCoverage = usePhaseCalendarCoverage()
  const {
    builderDrawSchedules,
    jobBillingSetupVersions,
    loading: billingSetupsLoading,
    error: billingSetupsError,
    refreshBuilderBillingSetups,
  } = useBuilderDrawSchedules()

  const metrics = useMemo(() => (
    buildDashboardMetrics(events, drawInvoicePackages, now, days)
  ), [events, drawInvoicePackages, now, days])
  const cutoffSuggestions = useMemo(() => buildUpcomingCutoffSuggestions({
    jobs,
    schedules: builderDrawSchedules,
    jobBillingSetupVersions,
    packages: drawInvoicePackages,
    productionActivities,
    asOfDate: metrics.startKey,
  }), [
    builderDrawSchedules,
    drawInvoicePackages,
    jobBillingSetupVersions,
    jobs,
    metrics.startKey,
    productionActivities,
  ])
  const jobsById = useMemo(() => new Map(jobs.map((job) => [String(job.id), job])), [jobs])
  const actionItems = useMemo(() => buildActionQueue({
    cutoffSuggestions,
    openInvoices: metrics.openInvoices,
    unscheduledPhases: phaseCoverage.ready ? phaseCoverage.unscheduled : [],
    jobsById,
    todayKey: metrics.startKey,
  }), [
    cutoffSuggestions,
    jobsById,
    metrics.openInvoices,
    metrics.startKey,
    phaseCoverage.ready,
    phaseCoverage.unscheduled,
  ])

  const productionPending = productionLoading || jobsLoading
  const queueLoading = productionLoading
    || jobsLoading
    || packagesLoading
    || billingSetupsLoading
    || (!phaseCoverage.ready && !phaseCoverage.error)
  const queueIncomplete = Boolean(
    productionError || jobsError || packagesError || billingSetupsError || phaseCoverage.error,
  )

  const refresh = async () => {
    refreshNow()
    await Promise.allSettled([
      refreshJobs(), refreshProductionActivities(), refreshDrawInvoicePackages(),
      refreshBuilderBillingSetups(),
    ])
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3, lg: 4 }, maxWidth: 1400, mx: 'auto', fontVariantNumeric: 'tabular-nums' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }} spacing={2}
        sx={{ alignItems: { sm: 'flex-end' }, justifyContent: 'space-between', mb: 3 }}
      >
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700, letterSpacing: '-0.015em' }}>
            {formatFullDay(now)}
          </Typography>
          {queueLoading
            ? <Skeleton variant="text" width={360} sx={{ maxWidth: '100%', fontSize: '1rem' }} />
            : (
              <Typography color="text.secondary" sx={{ maxWidth: '60ch' }}>
                {actionSummary(summarizeActionQueue(actionItems))}
              </Typography>
            )}
        </Box>
        <Button
          size="small" variant="outlined" startIcon={<RefreshRoundedIcon />}
          onClick={refresh}
          disabled={productionLoading || packagesLoading || jobsLoading || billingSetupsLoading}
          sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' } }}
        >
          Refresh data
        </Button>
      </Stack>

      {[jobsError, productionError, packagesError, billingSetupsError].filter(Boolean).map((error) => (
        <Alert key={error} severity="error" sx={{ mb: 2 }}>{error}</Alert>
      ))}

      <Paper
        variant="outlined"
        sx={{
          display: 'grid', mb: 2.5, borderRadius: 3, overflow: 'hidden',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.65fr) minmax(300px, 1fr)' },
        }}
      >
        <NeedsActionQueue items={actionItems} loading={queueLoading} incomplete={queueIncomplete} />
        <Box sx={{ borderTop: { xs: 1, lg: 0 }, borderLeft: { lg: 1 }, borderColor: 'divider' }}>
          <Box sx={{ p: 2.5 }}>
            <CollectionSummary
              pendingBalance={metrics.pendingBalance}
              aging={metrics.collectionAging}
              loading={packagesLoading}
            />
          </Box>
          <Box sx={{ p: 2.5, borderTop: 1, borderColor: 'divider' }}>
            <PackagePipeline statusCounts={metrics.packageStatusCounts} loading={packagesLoading} />
          </Box>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 3 }}>
        <ProductionSchedule
          timeline={metrics.timeline}
          startKey={metrics.startKey}
          endKey={metrics.endKey}
          days={days}
          onDaysChange={setDays}
          loading={productionPending}
          tentativeCount={metrics.tentativeCount}
        />
      </Paper>
    </Box>
  )
}
