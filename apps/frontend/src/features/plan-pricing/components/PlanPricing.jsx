import { useMemo, useState } from 'react'
import {
  Link as RouterLink,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import LocationCityRoundedIcon from '@mui/icons-material/LocationCityRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { initialBuilders } from '../../builders/data/builders.js'
import JobModuleNavigation from '../../jobs/components/JobModuleNavigation.jsx'
import {
  getJobOptionCount,
  getJobPlanCount,
  getJobUnitCount,
} from '../../jobs/data/jobs.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import {
  getJobBuilderId,
  jobBelongsToBuilder,
  jobPlanPricingPath,
  jobPlansOptionsPath,
} from '../../jobs/utils/jobRoutes.js'
import { priceSchema } from '../schemas/priceSchema.js'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

function hasPrice(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatPrice(value) {
  return hasPrice(value) ? currencyFormatter.format(value) : 'Not priced'
}

function PriceDialog({ target, onClose, onSave }) {
  const isPlan = target.type === 'plan'
  const currentPrice = isPlan ? target.plan.price : target.option.price
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      amount: hasPrice(currentPrice) ? String(currentPrice) : '',
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {isPlan ? `Edit Plan ${target.plan.code} price` : 'Edit option price'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {isPlan
            ? target.plan.name || `Plan ${target.plan.code}`
            : `${target.option.code} · ${target.option.description}`}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TextField
          autoFocus
          label={isPlan ? 'Base plan price' : 'Option price'}
          type="number"
          {...register('amount')}
          error={Boolean(errors.amount)}
          helperText={errors.amount?.message ?? 'USD · Up to 2 decimal places.'}
          fullWidth
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
            },
            htmlInput: { min: 0, step: 0.01, inputMode: 'decimal' },
          }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation>
          Save price
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function DetailMetric({ icon, label, value }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 170 }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: '16px !important' }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'primary.light',
            color: 'primary.main',
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

function JobField({ label, value }) {
  return (
    <Box sx={{ minWidth: 170 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25 }}>
        {value || 'Unassigned'}
      </Typography>
    </Box>
  )
}

function PlanPriceCard({ builderId, plan, position, jobId, onEditPlan, onEditOption }) {
  const options = plan.options ?? []

  return (
    <Card component="article" variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          px: { xs: 2, sm: 2.5 },
          py: 2,
          bgcolor: 'primary.light',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Box
              sx={{
                width: 42,
                height: 42,
                flexShrink: 0,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontWeight: 800,
              }}
            >
              {position}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="text.secondary" fontWeight={700}>
                Plan code {plan.code}
              </Typography>
              <Typography variant="h6" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
                {plan.name || `Plan ${plan.code}`}
              </Typography>
            </Box>
          </Stack>

          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Box sx={{ minWidth: 130 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                Base plan price
              </Typography>
              <Typography
                variant="h6"
                fontWeight={800}
                color={hasPrice(plan.price) ? 'text.primary' : 'text.secondary'}
              >
                {formatPrice(plan.price)}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="contained"
              startIcon={<EditOutlinedIcon />}
              onClick={onEditPlan}
              disableElevation
            >
              Edit plan price
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={750}>
              Pricing options
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Price for every P.O. / OPT # configured under this plan.
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            label={`${options.length} ${options.length === 1 ? 'option' : 'options'}`}
          />
        </Stack>

        {options.length > 0 ? (
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                display: { xs: 'none', md: 'grid' },
                gridTemplateColumns:
                  'minmax(150px, 0.28fr) minmax(220px, 1fr) minmax(140px, 0.24fr) auto',
                gap: 2,
                px: 2,
                py: 1,
                bgcolor: 'action.hover',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Typography variant="caption" color="text.secondary" fontWeight={750}>
                P.O. / OPT #
              </Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={750}>
                Description
              </Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={750}>
                Option price
              </Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={750}>
                Actions
              </Typography>
            </Box>

            {options.map((option, optionIndex) => (
              <Box
                key={option.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'minmax(150px, 0.28fr) minmax(220px, 1fr) minmax(140px, 0.24fr) auto',
                  },
                  alignItems: { md: 'center' },
                  gap: { xs: 1.25, md: 2 },
                  px: 2,
                  py: 1.5,
                  borderTop: optionIndex === 0 ? 0 : 1,
                  borderColor: 'divider',
                  bgcolor: optionIndex % 2 === 0 ? 'background.paper' : 'action.hover',
                }}
              >
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: { xs: 'block', md: 'none' }, mb: 0.5 }}
                  >
                    P.O. / OPT #
                  </Typography>
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={option.code}
                    sx={{ fontWeight: 750, maxWidth: '100%' }}
                  />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: { xs: 'block', md: 'none' }, mb: 0.25 }}
                  >
                    Description
                  </Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {option.description}
                  </Typography>
                </Box>
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: { xs: 'block', md: 'none' }, mb: 0.25 }}
                  >
                    Option price
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={750}
                    color={hasPrice(option.price) ? 'text.primary' : 'text.secondary'}
                  >
                    {formatPrice(option.price)}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<EditOutlinedIcon />}
                  onClick={() => onEditOption(option)}
                  sx={{ justifySelf: { xs: 'start', md: 'end' } }}
                >
                  Edit price
                </Button>
              </Box>
            ))}
          </Box>
        ) : (
          <Box
            sx={{
              py: 3,
              px: 2,
              textAlign: 'center',
              border: 1,
              borderStyle: 'dashed',
              borderColor: 'divider',
              borderRadius: 1.5,
              bgcolor: 'action.hover',
            }}
          >
            <ReceiptLongRoundedIcon color="disabled" sx={{ mb: 0.5 }} />
            <Typography variant="body2" fontWeight={700}>
              No options added to this plan
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
              Add options from the Job view before assigning their prices.
            </Typography>
            <Button
              component={RouterLink}
              to={jobPlansOptionsPath(builderId, jobId)}
              size="small"
              variant="outlined"
            >
              Manage job options
            </Button>
          </Box>
        )}
      </Box>
    </Card>
  )
}

function JobPricingSelector({ jobs, filteredJobs, search, onSearchChange, onSelectJob }) {
  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="overline" color="primary.main" fontWeight={750}>
          Plan pricing
        </Typography>
        <Typography variant="h5" fontWeight={750} color="text.primary">
          Choose a Job
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Search for a Job first, then review and update the prices for its plans and options.
        </Typography>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{
                mb: 2,
                alignItems: { sm: 'center' },
                justifyContent: 'space-between',
              }}
            >
              <Box>
                <Typography variant="subtitle1" fontWeight={750}>
                  Find a Job
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Search by Job number, builder or community.
                </Typography>
              </Box>
              <Chip
                size="small"
                variant="outlined"
                label={`${filteredJobs.length} ${filteredJobs.length === 1 ? 'result' : 'results'}`}
              />
            </Stack>

            <TextField
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by Job#, builder or community"
              fullWidth
              autoFocus
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
          </CardContent>

          {filteredJobs.length > 0 ? (
            <Stack divider={<Divider flexItem />}>
              {filteredJobs.map((job) => {
                const plans = job.sequenceSheet?.plans ?? []
                const options = plans.flatMap((plan) => plan.options ?? [])
                const pricedPlans = plans.filter((plan) => hasPrice(plan.price)).length
                const pricedOptions = options.filter((option) => hasPrice(option.price)).length

                return (
                  <Box
                    key={job.id}
                    sx={{
                      px: { xs: 2, sm: 2.5 },
                      py: 2,
                      display: 'flex',
                      alignItems: { xs: 'stretch', md: 'center' },
                      justifyContent: 'space-between',
                      flexDirection: { xs: 'column', md: 'row' },
                      gap: 2,
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: 'center', minWidth: 0 }}
                    >
                      <Box
                        sx={{
                          width: 44,
                          height: 44,
                          flexShrink: 0,
                          borderRadius: 1.5,
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: 'primary.light',
                          color: 'primary.main',
                        }}
                      >
                        <ApartmentRoundedIcon />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={800}>Job #{job.code}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {job.builder} · {job.community}
                        </Typography>
                      </Box>
                    </Stack>

                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                      sx={{ alignItems: { sm: 'center' } }}
                    >
                      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={`${pricedPlans} / ${plans.length} plan prices`}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`${pricedOptions} / ${options.length} option prices`}
                        />
                      </Stack>
                      <Button
                        variant="contained"
                        endIcon={<ArrowForwardRoundedIcon />}
                        onClick={() => onSelectJob(job.id)}
                        disableElevation
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        Manage pricing
                      </Button>
                    </Stack>
                  </Box>
                )
              })}
            </Stack>
          ) : (
            <Box sx={{ py: 7, px: 3, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
              <SearchRoundedIcon color="disabled" sx={{ fontSize: 42, mb: 1 }} />
              <Typography fontWeight={700}>
                {jobs.length > 0 ? 'No Jobs match your search' : 'No Jobs available'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {jobs.length > 0
                  ? 'Try another Job number, builder or community.'
                  : 'Create a Job and configure its plans before assigning prices.'}
              </Typography>
              {jobs.length === 0 && (
                <Button component={RouterLink} to="/jobs" variant="outlined" sx={{ mt: 2 }}>
                  Go to Jobs
                </Button>
              )}
            </Box>
          )}
        </Card>
      </Box>
    </Box>
  )
}

export default function PlanPricing() {
  const navigate = useNavigate()
  const { builderId, jobId } = useParams()
  const { jobs, setJobs } = useJobs()
  const [search, setSearch] = useState('')
  const [priceTarget, setPriceTarget] = useState(null)
  const [notice, setNotice] = useState(null)
  const job = jobId
    ? jobs.find(
        (item) =>
          String(item.id) === jobId &&
          jobBelongsToBuilder(item, builderId, initialBuilders),
      )
    : null
  const resolvedBuilderId = builderId ?? getJobBuilderId(job, initialBuilders)
  const plans = job?.sequenceSheet?.plans ?? []
  const options = plans.flatMap((plan) => plan.options ?? [])
  const pricedPlanCount = plans.filter((plan) => hasPrice(plan.price)).length
  const pricedOptionCount = options.filter((option) => hasPrice(option.price)).length
  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return jobs

    return jobs.filter((jobOption) =>
      [jobOption.code, jobOption.builder, jobOption.community]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [jobs, search])

  const selectJob = (selectedJobId) => {
    const selectedJob = jobs.find(
      (item) => String(item.id) === String(selectedJobId),
    )
    const selectedBuilderId = getJobBuilderId(selectedJob, initialBuilders)
    if (!selectedJob || selectedBuilderId == null) return

    navigate(jobPlanPricingPath(selectedBuilderId, selectedJob.id))
  }

  const handlePriceSave = ({ amount }) => {
    setJobs((currentJobs) =>
      currentJobs.map((currentJob) => {
        if (currentJob.id !== job.id) return currentJob

        return {
          ...currentJob,
          sequenceSheet: {
            ...currentJob.sequenceSheet,
            plans: (currentJob.sequenceSheet?.plans ?? []).map((plan) => {
              if (plan.id !== priceTarget.plan.id) return plan

              if (priceTarget.type === 'plan') return { ...plan, price: amount }

              return {
                ...plan,
                options: (plan.options ?? []).map((option) =>
                  option.id === priceTarget.option.id
                    ? { ...option, price: amount }
                    : option,
                ),
              }
            }),
          },
        }
      }),
    )
    setNotice({ severity: 'success', message: 'Price updated.' })
    setPriceTarget(null)
  }

  if (!jobId) {
    return (
      <JobPricingSelector
        jobs={jobs}
        filteredJobs={filteredJobs}
        search={search}
        onSearchChange={setSearch}
        onSelectJob={selectJob}
      />
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
            <Chip label="Active" size="small" color="success" variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {job.builder} · {job.community}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<SearchRoundedIcon />}
          onClick={() => navigate('/pricing')}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Change Job
        </Button>
      </Box>

      <JobModuleNavigation
        active="plan-pricing"
        builderId={resolvedBuilderId}
        jobId={job.id}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
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
              <JobField label="Supervisor" value={job.supervisor} />
              <JobField label="Jobsite Superintendent" value={job.jobsiteSuperintendent} />
            </Stack>
          </CardContent>
        </Card>

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
            <Chip
              label={`${plans.length} ${plans.length === 1 ? 'plan' : 'plans'}`}
              color="primary"
              variant="outlined"
              size="small"
            />
          </Box>

          {plans.length > 0 ? (
            <Stack spacing={2} sx={{ p: { xs: 2, sm: 2.5 } }}>
              {plans.map((plan, index) => (
                <PlanPriceCard
                  key={plan.id}
                  builderId={resolvedBuilderId}
                  plan={plan}
                  position={index + 1}
                  jobId={job.id}
                  onEditPlan={() => setPriceTarget({ type: 'plan', plan })}
                  onEditOption={(option) =>
                    setPriceTarget({ type: 'option', plan, option })
                  }
                />
              ))}
            </Stack>
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
        />
      )}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3000}
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
