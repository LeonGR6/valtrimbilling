import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, List, ListItemButton,
  Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import { useProductionActivities } from '../../features/calendar/context/useProductionActivities.js'
import { activityTypeOptions } from '../../features/calendar/data/calendarEvents.js'
import { formatDate } from '../../features/calendar/components/calendarSchedulerUtils.js'
import { useDrawInvoicePackages } from '../../features/draw-invoice/context/useDrawInvoicePackages.js'
import {
  DRAW_PACKAGE_STATUSES, DRAW_PACKAGE_STATUS_LABELS,
} from '../../features/draw-invoice/services/drawInvoicePackageRecord.js'
import { useJobs } from '../../features/jobs/context/useJobs.js'
import { jobDrawInvoicePath } from '../../features/jobs/utils/jobRoutes.js'
import DashboardDonut from '../../features/dashboard/components/DashboardDonut.jsx'
import { buildDashboardMetrics } from '../../features/dashboard/utils/dashboardMetrics.js'

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const eventColors = {
  EXT: 'primary.main',
  SHUTTER: 'info.main',
  DM: 'warning.main',
  HW: 'success.main',
}
const packageColors = {
  DRAFT: 'text.secondary',
  READY_TO_SUBMIT: 'info.main',
  AWAITING_PAYMENT: 'warning.main',
  PAID_CLOSED: 'success.main',
}

function MetricCard({ label, value, detail, icon, tone, to, loading }) {
  return (
    <Card
      component={RouterLink}
      to={to}
      variant="outlined"
      sx={{
        display: 'block', height: '100%', borderRadius: 3, color: 'text.primary',
        textDecoration: 'none', transition: 'border-color 150ms, transform 150ms',
        '&:hover': { borderColor: `${tone}.main`, transform: 'translateY(-2px)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary" fontWeight={650}>{label}</Typography>
          <Box sx={{ color: `${tone}.main` }}>{icon}</Box>
        </Stack>
        {loading
          ? <Skeleton variant="text" width="55%" height={48} sx={{ my: 0.25 }} />
          : <Typography variant="h4" fontWeight={800} sx={{ my: 0.6 }}>{value}</Typography>}
        <Typography variant="caption" color="text.secondary">{detail}</Typography>
      </CardContent>
    </Card>
  )
}

function SectionCard({ title, subtitle, linkLabel, to, children }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6" fontWeight={750}>{title}</Typography>
            <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
          </Box>
          {linkLabel && (
            <Button component={RouterLink} to={to} size="small" endIcon={<ArrowForwardRoundedIcon />} sx={{ flexShrink: 0 }}>
              {linkLabel}
            </Button>
          )}
        </Stack>
        {children}
      </CardContent>
    </Card>
  )
}

function EmptyList({ children }) {
  return <Typography variant="body2" color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>{children}</Typography>
}

function EventAgenda({ events, loading, days }) {
  if (loading) return <Skeleton variant="rounded" height={230} sx={{ mt: 2 }} />
  if (events.length === 0) return <EmptyList>No Production events in the next {days} days.</EmptyList>

  return (
    <List disablePadding sx={{ mt: 1.5 }}>
      {events.slice(0, 5).map((event, index) => {
        const props = event.extendedProps ?? {}
        const type = activityTypeOptions.find((option) => option.value === props.activityType)
        return (
          <Box component="li" key={event.id} sx={{ listStyle: 'none' }}>
            {index > 0 && <Divider />}
            <ListItemButton component={RouterLink} to="/calendar" sx={{ px: 1, py: 1.25, borderRadius: 1.5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ alignItems: { sm: 'center' }, width: '100%', minWidth: 0 }}>
                <Chip label={type?.shortLabel ?? props.activityType ?? 'Event'} size="small" variant="outlined" sx={{ width: 80, flexShrink: 0 }} />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700} noWrap>{event.title}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {props.jobCode ? `Job ${props.jobCode}` : 'Production'}
                    {props.community ? ` · ${props.community}` : ''}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  {props.dateOwner === 'TENTATIVE' && <Chip label="Tentative" color="warning" size="small" variant="outlined" />}
                  <Typography variant="caption" fontWeight={700}>{formatDate(event.start)}</Typography>
                </Stack>
              </Stack>
            </ListItemButton>
          </Box>
        )
      })}
    </List>
  )
}

function InvoiceAgenda({ invoices, jobsById, loading, days, todayKey }) {
  if (loading) return <Skeleton variant="rounded" height={230} sx={{ mt: 2 }} />
  if (invoices.length === 0) {
    return <EmptyList>No overdue invoices or invoices due in the next {days} days.</EmptyList>
  }

  return (
    <List disablePadding sx={{ mt: 1.5 }}>
      {invoices.slice(0, 5).map((record, index) => {
        const job = jobsById.get(String(record.jobId))
        const target = job
          ? jobDrawInvoicePath(record.builderId, record.jobId, record.phaseId, record.id)
          : '/draw-invoice'
        return (
          <Box component="li" key={record.id} sx={{ listStyle: 'none' }}>
            {index > 0 && <Divider />}
            <ListItemButton component={RouterLink} to={target} sx={{ px: 1, py: 1.25, borderRadius: 1.5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ alignItems: { sm: 'center' }, width: '100%', minWidth: 0 }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700} noWrap>
                    {record.invoiceNumber ? `Invoice ${record.invoiceNumber}` : record.packageNumber}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {job ? `Job ${job.code} · ${job.community}` : `Package ${record.packageNumber}`}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: { xs: 'space-between', sm: 'flex-end' }, flexShrink: 0 }}>
                  <Chip
                    label={record.overdue ? 'Overdue' : record.dueDate === todayKey ? 'Due today' : 'Upcoming'}
                    color={record.overdue ? 'error' : record.dueDate === todayKey ? 'warning' : 'info'}
                    size="small" variant="outlined"
                  />
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" fontWeight={750}>{currencyFormatter.format(record.balance)}</Typography>
                    <Typography variant="caption" color="text.secondary">Due {formatDate(record.dueDate)}</Typography>
                  </Box>
                </Stack>
              </Stack>
            </ListItemButton>
          </Box>
        )
      })}
    </List>
  )
}

export default function HomePage() {
  const [days, setDays] = useState(7)
  const [now, setNow] = useState(() => new Date())
  const {
    events, loading: productionLoading, error: productionError, refreshProductionActivities,
  } = useProductionActivities()
  const {
    drawInvoicePackages, loading: packagesLoading, error: packagesError, refreshDrawInvoicePackages,
  } = useDrawInvoicePackages()
  const { jobs, loading: jobsLoading, error: jobsError, refreshJobs } = useJobs()

  const metrics = useMemo(() => (
    buildDashboardMetrics(events, drawInvoicePackages, now, days)
  ), [events, drawInvoicePackages, now, days])
  const jobsById = useMemo(() => new Map(jobs.map((job) => [String(job.id), job])), [jobs])
  const eventChartItems = activityTypeOptions.map((type) => ({
    label: type.shortLabel, value: metrics.eventTypeCounts[type.value] ?? 0, color: eventColors[type.value],
  }))
  const packageChartItems = DRAW_PACKAGE_STATUSES.map((status) => ({
    label: DRAW_PACKAGE_STATUS_LABELS[status],
    value: metrics.packageStatusCounts[status] ?? 0,
    color: packageColors[status],
  }))
  const productionPending = productionLoading || jobsLoading

  const refresh = async () => {
    setNow(new Date())
    await Promise.allSettled([
      refreshJobs(), refreshProductionActivities(), refreshDrawInvoicePackages(),
    ])
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3, lg: 4 }, maxWidth: 1600, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={800}>Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">
            Production schedule and billing at a glance · {formatDate(metrics.startKey)}
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
          <Typography variant="body2" color="text.secondary" fontWeight={650}>Upcoming period</Typography>
          <ToggleButtonGroup
            value={days} exclusive size="small"
            onChange={(_, value) => { if (value) setDays(value) }}
            aria-label="Upcoming dashboard period"
          >
            {[7, 30, 90].map((value) => (
              <ToggleButton key={value} value={value} aria-label={`Next ${value} days`} sx={{ px: 1.5 }}>
                {value} days
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Button size="small" variant="outlined" startIcon={<RefreshRoundedIcon />}
            onClick={refresh} disabled={productionLoading || packagesLoading || jobsLoading}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      {[jobsError, productionError, packagesError].filter(Boolean).map((error) => (
        <Alert key={error} severity="error" sx={{ mb: 2 }}>{error}</Alert>
      ))}

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
        gap: 2, mb: 2.5,
      }}>
        <MetricCard label="Upcoming events" value={metrics.upcomingEvents.length}
          detail={`Scheduled Production dates · next ${days} days`}
          icon={<EventAvailableRoundedIcon />} tone="primary" to="/calendar" loading={productionPending} />
        <MetricCard label="Tentative dates" value={metrics.tentativeCount}
          detail={`Production dates to review · next ${days} days`}
          icon={<PendingActionsRoundedIcon />} tone="warning" to="/calendar" loading={productionPending} />
        <MetricCard label="Ready to submit" value={metrics.readyPackageCount}
          detail="Draw & Invoice Packages · all periods"
          icon={<TaskAltRoundedIcon />} tone="info" to="/draw-invoice" loading={packagesLoading} />
        <MetricCard label="Pending collection" value={currencyFormatter.format(metrics.pendingBalance)}
          detail="Unpaid balance of issued invoices"
          icon={<PaymentsRoundedIcon />} tone="success" to="/draw-invoice" loading={packagesLoading} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2, mb: 2.5 }}>
        <SectionCard title="Production by stage" subtitle={`Scheduled dates in the next ${days} days`}>
          {productionPending
            ? <Skeleton variant="rounded" height={205} sx={{ mt: 2 }} />
            : <DashboardDonut items={eventChartItems} centerLabel="events" emptyMessage="No scheduled events in this period." />}
        </SectionCard>
        <SectionCard title="Package workflow" subtitle="Current status of all Draw & Invoice Packages">
          {packagesLoading
            ? <Skeleton variant="rounded" height={205} sx={{ mt: 2 }} />
            : <DashboardDonut items={packageChartItems} centerLabel="packages" emptyMessage="No packages are available yet." />}
        </SectionCard>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
        <SectionCard title="Upcoming Production" subtitle={`Next ${days} days · first 5 events`} linkLabel="Calendar" to="/calendar">
          <EventAgenda events={metrics.upcomingEvents} loading={productionPending} days={days} />
        </SectionCard>
        <SectionCard title="Invoice due dates" subtitle={`Overdue and due in the next ${days} days · first 5 invoices`}
          linkLabel="Packages" to="/draw-invoice">
          <InvoiceAgenda invoices={metrics.dueInvoices} jobsById={jobsById}
            loading={packagesLoading || jobsLoading} days={days} todayKey={metrics.startKey} />
        </SectionCard>
      </Box>
    </Box>
  )
}
