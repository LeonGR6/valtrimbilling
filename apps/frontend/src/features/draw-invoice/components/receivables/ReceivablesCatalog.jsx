import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { useCurrentDate } from '../../../../hooks/useCurrentDate.js'
import { usePersistentState } from '../../../../hooks/usePersistentState.js'
import { useReceivables } from '../../hooks/useReceivables.js'
import { quickbooksLastInvoiceLabel } from '../../services/quickbooksRecord.js'
import { formatLongDate } from '../../utils/drawInvoiceFormatters.js'
import {
  DEFAULT_GROUP_SORT,
  DEFAULT_INVOICE_SORT,
  agingBucketLabel,
  buildReceivableInvoices,
  californiaDateKey,
  filterReceivables,
  groupReceivables,
  isReportDateAllowed,
  oldestPaymentCheck,
  receivableBuilderOptions,
  receivableJobOptions,
  sortReceivableGroups,
  sortReceivableInvoices,
  totalReceivables,
} from '../../utils/receivablesAging.js'
import ReceivablesGroupTable from './ReceivablesGroupTable.jsx'
import ReceivablesInvoiceTable from './ReceivablesInvoiceTable.jsx'
import ReceivablesSummary from './ReceivablesSummary.jsx'
import { nextSort } from './receivablesView.js'

const VIEWS = [
  { value: 'invoice', label: 'By Invoice' },
  { value: 'job', label: 'By Job' },
  { value: 'builder', label: 'By Builder' },
]
const isView = (value) => VIEWS.some((view) => view.value === value)

/**
 * The A/R section of Draw & Invoice: what is owed on the QuickBooks invoices, by how
 * long it is past its Due Date. One list of open invoices feeds the three views, so
 * what a Builder owes is always the sum of its Jobs, and a Job's the sum of its Invoices.
 */
export default function ReceivablesCatalog({ jobs }) {
  const receivables = useReceivables()
  const [now] = useCurrentDate()
  const today = californiaDateKey(now)

  const [view, setView] = usePersistentState('draw-invoice:ar:view', 'invoice', isView)
  const [pickedDate, setPickedDate] = useState(null)
  const [search, setSearch] = useState('')
  const [builderFilter, setBuilderFilter] = useState('ALL')
  const [jobFilter, setJobFilter] = useState('ALL')
  const [bucket, setBucket] = useState('ALL')
  const [invoiceSort, setInvoiceSort] = useState(DEFAULT_INVOICE_SORT)
  const [groupSort, setGroupSort] = useState(DEFAULT_GROUP_SORT)

  // Only today's balances are known, so a report date is today or later.
  const dateProblem = pickedDate != null && !isReportDateAllowed(pickedDate, today)
  const reportDate = pickedDate != null && !dateProblem ? pickedDate : today

  const invoices = useMemo(
    () => buildReceivableInvoices(receivables.records, { reportDate, jobs }),
    [receivables.records, reportDate, jobs],
  )
  const builderOptions = useMemo(() => receivableBuilderOptions(invoices), [invoices])
  // A choice that no longer has open invoices falls back to "All".
  const builderId = builderFilter === 'ALL' || builderOptions.some(({ id }) => id === builderFilter)
    ? builderFilter
    : 'ALL'
  const jobOptions = useMemo(() => receivableJobOptions(invoices, builderId), [invoices, builderId])
  const jobId = jobFilter === 'ALL' || jobOptions.some(({ id }) => id === jobFilter) ? jobFilter : 'ALL'

  // The bucket cards show every bucket of what is in scope, so they ignore the bucket choice.
  const scoped = useMemo(
    () => filterReceivables(invoices, { builderId, jobId, search }),
    [invoices, builderId, jobId, search],
  )
  const scopedTotals = useMemo(() => totalReceivables(scoped), [scoped])
  const visible = useMemo(
    () => (bucket === 'ALL' ? scoped : scoped.filter((invoice) => invoice.bucket === bucket)),
    [scoped, bucket],
  )
  const invoiceRows = useMemo(
    () => (view === 'invoice' ? sortReceivableInvoices(visible, invoiceSort) : []),
    [view, visible, invoiceSort],
  )
  const groupRows = useMemo(
    () => (view === 'invoice'
      ? []
      : sortReceivableGroups(groupReceivables(visible, view), groupSort)),
    [view, visible, groupSort],
  )

  const rowCount = view === 'invoice' ? invoiceRows.length : groupRows.length
  const filtersActive = search !== '' || builderId !== 'ALL' || jobId !== 'ALL' || bucket !== 'ALL'
  const checkedAt = oldestPaymentCheck(invoices)
  const checkedLabel = quickbooksLastInvoiceLabel(checkedAt, now)

  const chooseView = (_event, value) => {
    if (value) setView(value)
  }
  const sortBy = (setter) => (column, firstDirection) => {
    setter((current) => nextSort(current, column, firstDirection))
  }
  const clearFilters = () => {
    setSearch('')
    setBuilderFilter('ALL')
    setJobFilter('ALL')
    setBucket('ALL')
  }
  // From an amount to the invoices that make it up.
  const drill = ({ builderId: nextBuilder, jobId: nextJob, bucket: nextBucket }) => {
    setBuilderFilter(nextBuilder ?? 'ALL')
    setJobFilter(nextJob ?? 'ALL')
    setBucket(nextBucket ?? 'ALL')
    setView('invoice')
  }

  const initialLoad = receivables.loading && receivables.records.length === 0 && !receivables.error

  return (
    <Stack spacing={1.5} sx={{ p: { xs: 2, md: 3 } }}>
      {receivables.error && (
        <Alert
          severity="error"
          action={<Button color="inherit" onClick={receivables.reload}>Retry</Button>}
        >
          {receivables.error}
        </Alert>
      )}
      {receivables.checkError && <Alert severity="error">{receivables.checkError}</Alert>}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={chooseView}
          aria-label="Group accounts receivable"
        >
          {VIEWS.map(({ value, label }) => (
            <ToggleButton key={value} value={value} sx={{ px: 2, fontWeight: 750 }}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {checkedLabel
              ? `QuickBooks balances read ${checkedLabel}`
              : 'QuickBooks Production invoices'}
          </Typography>
          {receivables.canCheckPayments && (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={receivables.refreshFromQuickbooks}
              disabled={receivables.checking || receivables.loading}
              startIcon={receivables.checking
                ? <CircularProgress size={14} color="inherit" />
                : <RefreshRoundedIcon />}
            >
              {receivables.checking ? 'Checking QuickBooks…' : 'Refresh from QuickBooks'}
            </Button>
          )}
        </Stack>
      </Stack>

      <ReceivablesSummary
        totals={scopedTotals}
        invoices={scoped}
        bucket={bucket}
        onSelectBucket={setBucket}
      />

      <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          sx={{ p: 1, alignItems: { md: 'flex-start' }, borderBottom: 1, borderColor: 'divider' }}
        >
          <TextField
            type="date"
            size="small"
            label="Aged as of"
            value={pickedDate ?? reportDate}
            onChange={(event) => setPickedDate(event.target.value || null)}
            error={dateProblem}
            helperText={dateProblem
              ? 'Earlier days need payment history, which is not saved yet.'
              : reportDate === today
                ? 'Today'
                : 'Today’s balances, aged to this day'}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: today },
            }}
            sx={{ width: { md: 190 }, flexShrink: 0 }}
          />
          <TextField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Invoice, Package, Builder or Job"
            size="small"
            aria-label="Search accounts receivable"
            sx={{ flex: 2, minWidth: { md: 200 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            select
            size="small"
            label="Builder"
            value={builderId}
            onChange={(event) => {
              setBuilderFilter(event.target.value)
              setJobFilter('ALL')
            }}
            sx={{ flex: 1, minWidth: { md: 150 } }}
          >
            <MenuItem value="ALL">All builders</MenuItem>
            {builderOptions.map(({ id, name }) => (
              <MenuItem key={id} value={id}>{name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Job"
            value={jobId}
            onChange={(event) => setJobFilter(event.target.value)}
            sx={{ flex: 1, minWidth: { md: 130 } }}
          >
            <MenuItem value="ALL">All jobs</MenuItem>
            {jobOptions.map(({ id, name }) => (
              <MenuItem key={id} value={id}>{name}</MenuItem>
            ))}
          </TextField>
          <Button color="inherit" onClick={clearFilters} disabled={!filtersActive} sx={{ flexShrink: 0 }}>
            Clear filters
          </Button>
        </Stack>

        {bucket !== 'ALL' && (
          <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Chip
              size="small"
              label={`Only ${agingBucketLabel(bucket)}`}
              onDelete={() => setBucket('ALL')}
            />
          </Box>
        )}

        {initialLoad ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress size={28} aria-label="Loading accounts receivable" />
          </Box>
        ) : rowCount === 0 ? (
          <Box sx={{ px: 2, py: 5, textAlign: 'center' }}>
            <Typography fontWeight={800}>
              {filtersActive ? 'No invoices match these filters.' : 'Nothing is owed right now.'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {filtersActive
                ? 'Clear a filter to see more.'
                : 'Invoices created in QuickBooks Production show up here until they are paid.'}
            </Typography>
            {filtersActive && (
              <Button onClick={clearFilters} sx={{ mt: 1.5 }}>Clear filters</Button>
            )}
          </Box>
        ) : view === 'invoice' ? (
          <ReceivablesInvoiceTable
            invoices={invoiceRows}
            sort={invoiceSort}
            onSort={sortBy(setInvoiceSort)}
          />
        ) : (
          <ReceivablesGroupTable
            key={view}
            level={view}
            groups={groupRows}
            sort={groupSort}
            onSort={sortBy(setGroupSort)}
            onDrill={drill}
          />
        )}
      </Box>

      {reportDate !== today && (
        <Typography variant="caption" color="text.secondary">
          Aged as of {formatLongDate(reportDate)}. Balances are today’s, so this shows how they will age if nothing is paid.
        </Typography>
      )}
    </Stack>
  )
}
