import { useEffect, useState } from 'react'
import {
  Link as RouterLink,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import LocationCityRoundedIcon from '@mui/icons-material/LocationCityRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { useBuilderContacts } from '../../builder-contacts/context/useBuilderContacts.js'
import JobModuleNavigation from '../../jobs/components/JobModuleNavigation.jsx'
import PlanOptionNotes from '../../jobs/components/PlanOptionNotes.jsx'
import { filterPlansByQuery } from '../../jobs/utils/planSearch.js'
import { CatalogEmptyState } from '../../../components/common/CatalogPage'
import { previewPhasePriceChanges, previewPhasePriceChangesFor } from '../services/phasePriceRepository.js'
import { listPendingPriceDifferences } from '../services/priceDifferencesRepository.js'
import { formatSignedMoney, groupPriceDifferences } from '../utils/priceDifferences.js'
import JobPricingSelector from './JobPricingSelector.jsx'
import usePriceWorksheet from '../hooks/usePriceWorksheet.js'
import { changedPriceCount } from '../utils/priceWorksheet.js'
import PriceDifferencesDialog from './PriceDifferencesDialog.jsx'
import PriceWorksheetBar from './PriceWorksheetBar.jsx'
import UpdatePhasePricesDialog from './UpdatePhasePricesDialog.jsx'
import { getJobOptionCount, getJobPlanCount, getJobUnitCount } from '../../jobs/data/jobs.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { useDrawInvoicePackages } from '../../draw-invoice/context/useDrawInvoicePackages.js'
import { resolveJobContacts } from '../../jobs/utils/jobAssignments.js'
import { JobContactsGrid } from '../../jobs/components/JobContacts.jsx'
import { getJobBuilderId, jobBelongsToBuilder, jobPlansOptionsPath } from '../../jobs/utils/jobRoutes.js'
import { usePeople } from '../../people/context/usePeople.js'
import { hasPrice } from '../utils/planPriceFormat.js'
import { DetailMetric, JobField } from './PlanPricingDetailFields.jsx'
import PlanPricingSheet from './PlanPricingSheet.jsx'
import PriceDialog from './PriceDialog.jsx'

export default function PlanPricing() {
  const navigate = useNavigate()
  const { builderId, jobId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    jobs,
    loading,
    error,
    canManageJobs,
    refreshJobs,
    saveJobPlanPrice,
    saveJobPrices,
    savePlanOptionPrice,
  } = useJobs()
  const { refreshDrawInvoicePackages } = useDrawInvoicePackages()
  const { builderDrawSchedules } = useBuilderDrawSchedules()
  const { people } = usePeople()
  const { contacts: builderContacts } = useBuilderContacts()
  const [priceTarget, setPriceTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)
  // Phases created before a price change keep their price until someone moves them.
  const [phasePriceDialog, setPhasePriceDialog] = useState(null)
  // What Packages that cannot change would still bill at the new prices.
  const [differencesOpen, setDifferencesOpen] = useState(searchParams.get('differences') === '1')
  const [differenceTotals, setDifferenceTotals] = useState(null)
  const [differenceRefresh, setDifferenceRefresh] = useState(0)
  const job = jobId
    ? jobs.find(
        (item) =>
          String(item.id) === jobId &&
          jobBelongsToBuilder(item, builderId),
      )
    : null
  const jobContacts = resolveJobContacts(job, people, builderContacts)
  const resolvedBuilderId = builderId ?? getJobBuilderId(job)
  const builderSetup = builderDrawSchedules.find(
    (setup) => String(setup.builderId) === String(resolvedBuilderId),
  )
  const separateHardwarePrice = Boolean(builderSetup?.separateHardwarePrice)
  const canManagePricing = canManageJobs && job?.isActive
  const jobIdForDifferences = job?.id
  useEffect(() => {
    if (!canManagePricing || jobIdForDifferences == null) return undefined

    let cancelled = false
    listPendingPriceDifferences({ jobId: jobIdForDifferences })
      .then(({ rows, statuses }) => {
        if (cancelled) return
        const { totals } = groupPriceDifferences(rows, statuses)
        setDifferenceTotals(totals.lineCount > 0 ? totals : null)
      })
      .catch(() => {
        if (!cancelled) setDifferenceTotals(null)
      })

    return () => { cancelled = true }
  }, [canManagePricing, jobIdForDifferences, differenceRefresh])

  const closeDifferences = () => {
    setDifferencesOpen(false)
    // An adjustment may have collected differences: the badge must not keep showing them.
    setDifferenceRefresh((count) => count + 1)
    if (searchParams.has('differences')) {
      const next = new URLSearchParams(searchParams)
      next.delete('differences')
      setSearchParams(next, { replace: true })
    }
  }
  const plans = job?.sequenceSheet?.plans ?? []
  const worksheet = usePriceWorksheet(plans, { separateHardwarePrice })
  // The search only narrows what is listed: the worksheet keeps every price typed in the Plans and
  // Options that are out of sight, and saves them all.
  const [query, setQuery] = useState('')
  const visiblePlans = filterPlansByQuery(plans, query)
  const searching = Boolean(query.trim())
  const hasUnsavedChanges = worksheet.editing && worksheet.evaluation.changeCount > 0
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined

    const warn = (event) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedChanges])
  const options = plans.flatMap((plan) => plan.options ?? [])
  const pricedPlanCount = plans.filter((plan) => hasPrice(plan.price)).length
  const pricedOptionCount = options.filter((option) => hasPrice(option.price)).length
  // The new price only reaches Phases created from now on. If older Phases still
  // use the previous one, offer to move them; a failed look-up never blocks the save.
  const offerExistingPhaseUpdate = async (savedTarget) => {
    if (!canManagePricing) return

    const filter = savedTarget.type === 'option'
      ? { optionId: savedTarget.option.id, components: 'OPTIONS', fromSave: true }
      : { planId: savedTarget.plan.id, components: 'PLAN', fromSave: true }

    try {
      const rows = await previewPhasePriceChanges(job.id, filter)
      if (rows.length > 0) setPhasePriceDialog(filter)
    } catch {
      // The price is saved; the update can still be started from the button.
    }
  }

  // The same question for everything saved from the sheet: one look-up, one dialog.
  const offerExistingPhaseUpdateForChanges = async (changes) => {
    if (!canManagePricing || changes.length === 0) return

    try {
      const rows = await previewPhasePriceChangesFor(job.id, changes)
      if (rows.length === 0) return

      const hasPlan = changes.some((change) => change.type === 'plan')
      const hasOptions = changes.some((change) => change.type === 'option')
      setPhasePriceDialog({
        batch: changes,
        rows,
        loadRows: () => previewPhasePriceChangesFor(job.id, changes),
        fromSave: true,
        components: hasPlan && hasOptions ? 'ALL' : hasPlan ? 'PLAN' : 'OPTIONS',
      })
    } catch {
      // The prices are saved; the update can still be started from the button.
    }
  }

  const finishWorksheet = async (savedChanges = []) => {
    worksheet.stop()
    await offerExistingPhaseUpdateForChanges(savedChanges)
  }

  const handleWorksheetSave = async () => {
    const { errors, changes } = worksheet.evaluation
    if (errors.size > 0) {
      setNotice({
        severity: 'error',
        message: `Fix the ${errors.size === 1 ? 'price' : `${errors.size} prices`} marked in red before saving.`,
      })
      const firstInvalid = [...document.querySelectorAll('[data-price-sheet] input[aria-invalid="true"]')]
        .find((input) => input.offsetParent !== null)
      firstInvalid?.focus()
      return
    }
    if (changes.length === 0) return

    const total = changes.reduce((sum, change) => sum + changedPriceCount(change), 0)
    setSubmitting(true)
    try {
      // One request for the whole sheet: every price is saved or none is, so a failure leaves
      // everything on the sheet to try again.
      try {
        await saveJobPrices(job.id, changes)
      } catch (saveError) {
        setNotice({
          severity: 'error',
          persist: true,
          message: `No price was saved. ${saveError.message} The prices are still here.`,
        })
        return
      }

      setNotice({
        severity: 'success',
        message: `${total} ${total === 1 ? 'price' : 'prices'} saved.`,
      })
      await finishWorksheet(changes)
    } finally {
      setSubmitting(false)
    }
  }

  const handleWorksheetDiscard = () => worksheet.stop()

  const handlePriceSave = async ({ amount, notApplicable = false }) => {
    setSubmitting(true)
    try {
      if (priceTarget.type === 'option') {
        await savePlanOptionPrice(
          job.id,
          priceTarget.plan.id,
          priceTarget.option.id,
          amount,
          notApplicable,
        )
      } else {
        const hardwarePrice = priceTarget.type === 'hardware'
          ? amount
          : priceTarget.plan.hardwarePrice ?? null
        await saveJobPlanPrice(
          job.id,
          priceTarget.plan.id,
          priceTarget.type === 'hardware' ? priceTarget.plan.price : amount,
          hardwarePrice,
        )
      }

      setNotice({
        severity: 'success',
        message: priceTarget.type === 'hardware'
          ? 'Hardware price updated.'
          : 'Price updated.',
      })
      const savedTarget = priceTarget
      setPriceTarget(null)
      await offerExistingPhaseUpdate(savedTarget)
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
    }
  }

  if (!jobId) {
    return (
      <JobPricingSelector
        jobs={jobs}
        loading={loading}
        error={error}
        onRetry={() => refreshJobs().catch(() => {})}
      />
    )
  }

  if (loading && !job) {
    return (
      <Box sx={{ py: 10, px: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">Loading Job pricing...</Typography>
      </Box>
    )
  }

  if (!job) {
    return (
      <Box sx={{ py: 10, px: 3, textAlign: 'center' }}>
        <ApartmentRoundedIcon color="action" sx={{ fontSize: 46, mb: 1 }} />
        <Typography variant="h6" fontWeight={700}>
          {jobId ? 'Job unavailable' : 'No Jobs available'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          {jobId
            ? 'Return to Jobs and choose a Job that belongs to this builder.'
            : 'Create a Job and configure its plans before assigning prices.'}
        </Typography>
        <Button component={RouterLink} to="/pricing" variant="outlined">
          Browse pricing Jobs
        </Button>
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          flexDirection: { xs: 'column', sm: 'row' },
        }}
      >
        <Box>
          <Typography variant="caption" color="primary.main" fontWeight={700}>
            Plan pricing / Job {job.code}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h5" fontWeight={700} color="text.primary">
              Job {job.code} · Plan pricing
            </Typography>
            <Chip
              label={job.isActive ? 'Active' : 'Inactive'}
              size="small"
              color={job.isActive ? 'success' : 'default'}
              variant="outlined"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {job.builder} · {job.community}
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          {canManagePricing && (
            <Button
              variant="outlined"
              startIcon={<LayersRoundedIcon />}
              onClick={() => setPhasePriceDialog({})}
              disabled={worksheet.editing}
            >
              Update existing Phases
            </Button>
          )}
          {canManagePricing && (
            <Button
              variant="outlined"
              color={differenceTotals ? 'warning' : 'primary'}
              startIcon={<ReceiptLongRoundedIcon />}
              onClick={() => setDifferencesOpen(true)}
              disabled={worksheet.editing}
            >
              {differenceTotals
                ? `Price differences · ${formatSignedMoney(differenceTotals.net)}`
                : 'Price differences'}
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<SearchRoundedIcon />}
            onClick={() => navigate('/pricing')}
          >
            Change Job
          </Button>
        </Stack>
      </Box>

      <JobModuleNavigation
        active="plan-pricing"
        builderId={resolvedBuilderId}
        jobId={job.id}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {error && (
          <Alert
            severity="error"
            action={(
              <Button color="inherit" size="small" onClick={() => refreshJobs().catch(() => {})}>
                Retry
              </Button>
            )}
            sx={{ mb: 2.5 }}
          >
            {error}
          </Alert>
        )}
        {!canManagePricing && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            {job.isActive
              ? 'You can review pricing, but your role cannot change it.'
              : 'This Job is inactive. Its Plan and Option prices are read-only.'}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <DetailMetric
            icon={<ApartmentRoundedIcon />}
            label="Total lots"
            value={getJobUnitCount(job)}
          />
          <DetailMetric
            icon={<LayersRoundedIcon />}
            label="Plan prices"
            value={`${pricedPlanCount} / ${getJobPlanCount(job)}`}
          />
          <DetailMetric
            icon={<AttachMoneyRoundedIcon />}
            label="Option prices"
            value={`${pricedOptionCount} / ${getJobOptionCount(job)}`}
          />
        </Stack>

        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: '20px !important' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
              <LocationCityRoundedIcon color="primary" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={700}>
                Job information
              </Typography>
            </Stack>
            <Divider sx={{ mb: 2 }} />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 2, sm: 4 }}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <JobField label="Builder" value={job.builder} />
              <JobField label="Community / Project" value={job.community} />
            </Stack>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2.5, mb: 0.5 }}>
              Contacts
            </Typography>
            <JobContactsGrid contacts={jobContacts} />
          </CardContent>
        </Card>

        <PlanOptionNotes job={job} canAdd={canManageJobs} />

        {worksheet.editing && (
          <PriceWorksheetBar
            changeCount={worksheet.evaluation.changeCount}
            errorCount={worksheet.evaluation.errors.size}
            saving={submitting}
            onSave={handleWorksheetSave}
            onDiscard={handleWorksheetDiscard}
          />
        )}

        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              px: 2.5,
              py: 2,
              borderBottom: 1,
              borderColor: 'divider',
              display: 'flex',
              alignItems: { xs: 'flex-start', sm: 'center' },
              justifyContent: 'space-between',
              gap: 1.5,
              flexDirection: { xs: 'column', sm: 'row' },
            }}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Plan pricing &amp; pricing options
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                Review each plan and set the price for the plan and every option below it.
              </Typography>
            </Box>
            <Stack
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ alignItems: 'center', flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' } }}
            >
              {plans.length > 0 && (
                <TextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  size="small"
                  placeholder="Search plans or options"
                  sx={{ width: { xs: '100%', sm: 300 } }}
                  slotProps={{
                    htmlInput: { 'aria-label': 'Search plans or options' },
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchRoundedIcon fontSize="small" color="action" />
                        </InputAdornment>
                      ),
                      endAdornment: query ? (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            edge="end"
                            aria-label="Clear search"
                            onClick={() => setQuery('')}
                          >
                            <ClearRoundedIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      ) : null,
                    },
                  }}
                />
              )}
              <Chip
                label={`${plans.length} ${plans.length === 1 ? 'plan' : 'plans'}`}
                color="primary"
                variant="outlined"
                size="small"
              />
              {canManagePricing && plans.length > 0 && !worksheet.editing && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<EditNoteRoundedIcon />}
                  onClick={worksheet.start}
                  disabled={submitting}
                  disableElevation
                  sx={{ textTransform: 'none' }}
                >
                  Edit prices
                </Button>
              )}
            </Stack>
          </Box>

          {plans.length > 0 && visiblePlans.length === 0 ? (
            <CatalogEmptyState
              title="No plans or options found"
              description={`Nothing in Job ${job.code} matches “${query.trim()}”.`}
              action={(
                <Button size="small" variant="outlined" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              )}
            />
          ) : plans.length > 0 ? (
            <PlanPricingSheet
              builderId={resolvedBuilderId}
              jobId={job.id}
              plans={visiblePlans}
              searching={searching}
              canManage={canManagePricing}
              submitting={submitting}
              separateHardwarePrice={separateHardwarePrice}
              worksheet={worksheet}
              onEditPlan={(plan) => setPriceTarget({ type: 'plan', plan })}
              onEditHardware={(plan) => setPriceTarget({ type: 'hardware', plan })}
              onEditOption={(plan, option) =>
                setPriceTarget({ type: 'option', plan, option })
              }
            />
          ) : (
            <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
              <LayersRoundedIcon color="action" sx={{ fontSize: 42, mb: 1 }} />
              <Typography fontWeight={700}>No plans configured for this Job</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                Add plans and options from the Job view before assigning their prices.
              </Typography>
              <Button
                component={RouterLink}
                to={jobPlansOptionsPath(resolvedBuilderId, job.id)}
                variant="outlined"
              >
                Manage job plans
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {priceTarget && (
        <PriceDialog
          key={`${priceTarget.type}-${priceTarget.option?.id ?? priceTarget.plan.id}`}
          target={priceTarget}
          onClose={() => setPriceTarget(null)}
          onSave={handlePriceSave}
          submitting={submitting}
        />
      )}

      {differencesOpen && canManagePricing && (
        <PriceDifferencesDialog job={job} onClose={closeDifferences} />
      )}

      {phasePriceDialog && (
        <UpdatePhasePricesDialog
          key={`${phasePriceDialog.planId ?? ''}-${phasePriceDialog.optionId ?? ''}-${phasePriceDialog.components ?? 'ALL'}${phasePriceDialog.batch ? '-batch' : ''}`}
          job={job}
          filter={phasePriceDialog}
          initialRows={phasePriceDialog.rows}
          loadRows={phasePriceDialog.loadRows}
          onClose={() => setPhasePriceDialog(null)}
          onApplied={async (result) => {
            // The Phases (their prices) and the Packages (their amounts, totals and
            // status) changed: reload both so no screen shows the old numbers until
            // the user refreshes the page.
            await Promise.all([
              refreshJobs().catch(() => {}),
              refreshDrawInvoicePackages().catch(() => {}),
            ])
            setDifferenceRefresh((count) => count + 1)
            const recalculated = result.packages ?? []
            const owed = result.differences ?? []
            const owedNet = owed.reduce((total, item) => total + Number(item.delta_net), 0)
            const regenerate = recalculated
              .filter((item) => item.documents_removed > 0)
              .map((item) => item.package_number)
            setNotice({
              severity: 'success',
              message: [
                `Updated ${result.lots} Plan ${result.lots === 1 ? 'price' : 'prices'} and ${result.options} Option ${result.options === 1 ? 'price' : 'prices'} in existing Phases.`,
                recalculated.length > 0
                  ? `Recalculated ${recalculated.map((item) => item.package_number).join(', ')}.`
                  : null,
                regenerate.length > 0
                  ? `Generate the Release and Payment Schedule again for ${regenerate.join(', ')}.`
                  : null,
                owed.length > 0
                  ? `${owed.map((item) => item.package_number).join(', ')} keep their amount; pending to collect ${formatSignedMoney(Math.round(owedNet * 100) / 100)} net.`
                  : null,
              ].filter(Boolean).join(' '),
              persist: regenerate.length > 0 || owed.length > 0,
            })
          }}
        />
      )}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={notice?.persist ? null : 3000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={notice?.severity ?? 'success'}
          onClose={() => setNotice(null)}
          variant="filled"
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
