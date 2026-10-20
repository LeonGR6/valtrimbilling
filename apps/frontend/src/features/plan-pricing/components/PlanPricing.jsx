import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Link as RouterLink,
  useNavigate,
  useParams,
  useSearchParams,
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
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { useBuilderContacts } from '../../builder-contacts/context/useBuilderContacts.js'
import JobModuleNavigation from '../../jobs/components/JobModuleNavigation.jsx'
import PlanToggle from '../../jobs/components/PlanToggle.jsx'
import { optionPricingSummary } from '../utils/optionPricing.js'
import { previewPhasePriceChanges } from '../services/phasePriceRepository.js'
import { listPendingPriceDifferences } from '../services/priceDifferencesRepository.js'
import {
  formatSignedMoney,
  groupPriceDifferences,
} from '../utils/priceDifferences.js'
import PriceDifferencesDialog from './PriceDifferencesDialog.jsx'
import UpdatePhasePricesDialog from './UpdatePhasePricesDialog.jsx'
import {
  getJobOptionCount,
  getJobPlanCount,
  getJobUnitCount,
} from '../../jobs/data/jobs.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { useDrawInvoicePackages } from '../../draw-invoice/context/useDrawInvoicePackages.js'
import { resolveJobContacts } from '../../jobs/utils/jobAssignments.js'
import { JobContactsGrid } from '../../jobs/components/JobContacts.jsx'
import {
  getJobBuilderId,
  jobBelongsToBuilder,
  jobPlanPricingPath,
  jobPlansOptionsPath,
} from '../../jobs/utils/jobRoutes.js'
import { usePeople } from '../../people/context/usePeople.js'
import {
  createHardwarePriceSchema,
  optionPriceSchema,
  priceSchema,
} from '../schemas/priceSchema.js'

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

// An Option priced NA adds and subtracts nothing, and reads "NA", not "$0.00".
function formatOptionPrice(option) {
  return option.priceNotApplicable ? 'NA' : formatPrice(option.price)
}

function PriceDialog({ target, onClose, onSave, submitting }) {
  const isPlan = target.type === 'plan'
  const isHardware = target.type === 'hardware'
  const currentPrice = isPlan
    ? target.plan.price
    : isHardware
      ? target.plan.hardwarePrice
      : target.option.price
  const schema = useMemo(
    () => isHardware
      ? createHardwarePriceSchema(target.plan.price)
      : isPlan ? priceSchema : optionPriceSchema,
    [isHardware, isPlan, target.plan.price],
  )
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: !isPlan && !isHardware && target.option.priceNotApplicable
        ? 'NA'
        : hasPrice(currentPrice) ? String(currentPrice) : '',
    },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const itemLabel = isPlan ? 'Plan' : isHardware ? 'Hardware' : 'Option'
  const itemCode = isPlan || isHardware ? target.plan.code : target.option.code
  const priceLabel = isPlan
    ? 'Plan price'
    : isHardware
      ? 'Hardware price'
      : 'Option price'

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h6" component="div" fontWeight={750}>
              Edit {priceLabel.toLowerCase()}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {isPlan || isHardware
                ? target.plan.name || `Plan ${target.plan.code}`
                : target.option.description}
            </Typography>
          </Box>
          <Chip size="small" variant="outlined" color="primary" label="Pricing worksheet" />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ width: 135, fontWeight: 750, color: 'text.secondary' }}>
                  Item
                </TableCell>
                <TableCell sx={{ width: 190, fontWeight: 750, color: 'text.secondary' }}>
                  Code
                </TableCell>
                <TableCell sx={{ fontWeight: 750, color: 'text.secondary' }}>
                  {priceLabel} <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ verticalAlign: 'top' }}>
                <TableCell sx={{ pt: 2.25 }}>
                  <Typography variant="body2" fontWeight={750}>{itemLabel}</Typography>
                </TableCell>
                <TableCell sx={{ pt: 2.25 }}>
                  <Typography
                    component={isPlan || isHardware ? 'strong' : 'span'}
                    variant="body1"
                    sx={{
                      fontWeight: isPlan || isHardware ? '900 !important' : 700,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {itemCode}
                  </Typography>
                </TableCell>
                <TableCell>
                  <TextField
                    autoFocus
                    placeholder={isPlan || isHardware ? '0.00' : '0.00 or NA'}
                    type={isPlan || isHardware ? 'number' : 'text'}
                    {...register('amount')}
                    error={Boolean(errors.amount)}
                    helperText={
                      errors.amount?.message
                      ?? (isPlan || isHardware
                        ? 'USD · Up to 2 decimal places.'
                        : 'USD · Up to 2 decimal places. A negative price is a credit and is subtracted when the option is billed. Type NA if no price applies: it adds and subtracts nothing.')
                    }
                    fullWidth
                    size="small"
                    slotProps={{
                      input: {
                        startAdornment: isPlan || isHardware
                          ? <InputAdornment position="start">$</InputAdornment>
                          : undefined,
                      },
                      htmlInput: {
                        ...(isPlan || isHardware ? { min: 0 } : {}),
                        step: 0.01,
                        // An Option price can be negative or "NA", which a numeric
                        // keypad cannot type.
                        inputMode: isPlan || isHardware ? 'decimal' : 'text',
                        'aria-label': priceLabel,
                      },
                    }}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation disabled={submitting}>
          {submitting ? 'Saving...' : 'Save price'}
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

// Warns that some options of a Plan have no price yet (NA counts as priced), open
// or closed, so a missing price is never hidden behind a collapsed Plan.
function MissingPricesChip({ summary }) {
  const { missing } = summary
  if (missing === 0) return null

  return (
    <Chip
      size="small"
      color="warning"
      variant="outlined"
      icon={<WarningAmberRoundedIcon />}
      label={`${missing} ${missing === 1 ? 'option' : 'options'} without price`}
      sx={{ fontWeight: 700 }}
    />
  )
}

// What an Option costs: its price, "NA", or a warning when it has none yet.
function OptionPriceValue({ option }) {
  if (!hasPrice(option.price)) {
    return (
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        label="Not priced"
        sx={{ fontWeight: 700 }}
      />
    )
  }

  return (
    <Typography variant="body2" fontWeight={750}>
      {formatOptionPrice(option)}
    </Typography>
  )
}

function PlanPriceCard({
  builderId,
  plan,
  position,
  jobId,
  canManage,
  submitting,
  separateHardwarePrice,
  expanded = true,
  onToggle = null,
  onEditPlan,
  onEditHardware,
  onEditOption,
}) {
  const options = plan.options ?? []
  const hardwareIsPriced = hasPrice(plan.hardwarePrice)
  const summary = optionPricingSummary(options)

  return (
    <Card component="article" variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          px: { xs: 2, sm: 2.5 },
          py: 2,
          bgcolor: 'primary.light',
          borderBottom: expanded ? 1 : 0,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            {onToggle && (
              <PlanToggle
                plan={plan}
                expanded={expanded}
                onToggle={onToggle}
                controls={`plan-pricing-${plan.id}`}
              />
            )}
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
            <Box
              onClick={onToggle ?? undefined}
              sx={{ minWidth: 0, cursor: onToggle ? 'pointer' : 'default' }}
            >
              <Typography variant="overline" color="text.secondary" fontWeight={700}>
                Plan code {plan.code}
              </Typography>
              <Typography variant="h6" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
                {plan.name || `Plan ${plan.code}`}
              </Typography>
              {summary.complete ? (
                !expanded && (
                  <Typography variant="caption" color="text.secondary" fontWeight={650}>
                    {summary.label}
                  </Typography>
                )
              ) : (
                <Box sx={{ mt: 0.5 }}>
                  <MissingPricesChip summary={summary} />
                </Box>
              )}
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
                Plan price
              </Typography>
              <Typography
                variant="h6"
                fontWeight={800}
                color={hasPrice(plan.price) ? 'text.primary' : 'text.secondary'}
              >
                {formatPrice(plan.price)}
              </Typography>
            </Box>
            {separateHardwarePrice && (
              <Box sx={{ minWidth: 150 }}>
                <Typography variant="caption" color="text.secondary" component="div">
                  Hardware price · 100%
                </Typography>
                <Typography
                  variant="h6"
                  fontWeight={800}
                  color={hardwareIsPriced ? 'text.primary' : 'warning.main'}
                >
                  {formatPrice(plan.hardwarePrice)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Additional to Plan Price
                </Typography>
              </Box>
            )}
            <Button
              size="small"
              variant="contained"
              startIcon={<EditOutlinedIcon />}
              onClick={onEditPlan}
              disabled={!canManage || submitting}
              disableElevation
            >
              Edit plan price
            </Button>
            {separateHardwarePrice && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<ConstructionRoundedIcon />}
                onClick={onEditHardware}
                disabled={!canManage || submitting || !hasPrice(plan.price)}
              >
                {hardwareIsPriced ? 'Edit hardware price' : 'Set hardware price'}
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box id={`plan-pricing-${plan.id}`} sx={{ p: { xs: 2, sm: 2.5 } }}>
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
                Price for every OPT # configured under this plan.
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
                  OPT #
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
                      OPT #
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
                    <OptionPriceValue option={option} />
                  </Box>
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<EditOutlinedIcon />}
                    onClick={() => onEditOption(option)}
                    disabled={!canManage || submitting}
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
      </Collapse>
    </Card>
  )
}

function PlanPricingSheet({
  builderId,
  jobId,
  plans,
  canManage,
  submitting,
  separateHardwarePrice,
  onEditPlan,
  onEditHardware,
  onEditOption,
}) {
  const columnCount = separateHardwarePrice ? 6 : 5
  // Every Plan starts closed, as in Plans & options; the person opens the ones
  // they are pricing and they stay open while prices are saved.
  const [openIds, setOpenIds] = useState(() => new Set())
  const isOpen = (plan) => openIds.has(plan.id)
  const allOpen = plans.length > 0 && plans.every(isOpen)
  const toggle = (plan) => setOpenIds((current) => {
    const next = new Set(current)
    if (next.has(plan.id)) next.delete(plan.id)
    else next.add(plan.id)
    return next
  })
  const toggleAll = () => setOpenIds(allOpen ? new Set() : new Set(plans.map(({ id }) => id)))

  return (
    <>
      {plans.length > 1 && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', px: { xs: 2, md: 1.5 }, pt: 1 }}>
          <Button size="small" color="inherit" onClick={toggleAll}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        </Stack>
      )}

      <Stack spacing={2} sx={{ display: { xs: 'flex', md: 'none' }, p: 2 }}>
        {plans.map((plan, index) => (
          <PlanPriceCard
            key={plan.id}
            builderId={builderId}
            plan={plan}
            position={index + 1}
            jobId={jobId}
            canManage={canManage}
            submitting={submitting}
            separateHardwarePrice={separateHardwarePrice}
            expanded={isOpen(plan)}
            onToggle={() => toggle(plan)}
            onEditPlan={() => onEditPlan(plan)}
            onEditHardware={() => onEditHardware(plan)}
            onEditOption={(option) => onEditOption(plan, option)}
          />
        ))}
      </Stack>

      <TableContainer sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table
          size="small"
          aria-label="Plan and option pricing worksheet"
          sx={{ minWidth: separateHardwarePrice ? 1120 : 940 }}
        >
          <TableHead>
            <TableRow
              sx={{
                bgcolor: 'action.hover',
                '& th': {
                  py: 1.25,
                  color: 'text.secondary',
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                },
              }}
            >
              <TableCell sx={{ width: 120 }}>Item</TableCell>
              <TableCell sx={{ width: 180 }}>Code</TableCell>
              <TableCell>Name / description</TableCell>
              <TableCell sx={{ width: 160 }}>Price</TableCell>
              {separateHardwarePrice && (
                <TableCell sx={{ width: 190 }}>Hardware price</TableCell>
              )}
              <TableCell align="right" sx={{ width: separateHardwarePrice ? 300 : 180 }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((plan) => {
              const planOptions = plan.options ?? []
              const hardwareIsPriced = hasPrice(plan.hardwarePrice)
              const expanded = isOpen(plan)
              const summary = optionPricingSummary(planOptions)

              return (
                <Fragment key={plan.id}>
                  <TableRow sx={{ bgcolor: 'primary.light', '& td': { py: 1.25 } }}>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', ml: -1 }}>
                        <PlanToggle
                          plan={plan}
                          expanded={expanded}
                          onToggle={() => toggle(plan)}
                        />
                        <Typography variant="body2" fontWeight={800} color="primary.main">
                          Plan
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography
                        component="strong"
                        variant="body1"
                        sx={{
                          display: 'inline-block',
                          color: 'text.primary',
                          fontWeight: '900 !important',
                          letterSpacing: '0.01em',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {plan.code}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                        {plan.name || `Plan ${plan.code}`}
                      </Typography>
                      {summary.complete ? (
                        !expanded && (
                          <Typography variant="caption" color="text.secondary" fontWeight={650}>
                            {summary.label}
                          </Typography>
                        )
                      ) : (
                        <Box sx={{ mt: 0.5 }}>
                          <MissingPricesChip summary={summary} />
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        fontWeight={800}
                        color={hasPrice(plan.price) ? 'text.primary' : 'text.secondary'}
                      >
                        {formatPrice(plan.price)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Plan price
                      </Typography>
                    </TableCell>
                    {separateHardwarePrice && (
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight={800}
                          color={hardwareIsPriced ? 'text.primary' : 'warning.main'}
                        >
                          {formatPrice(plan.hardwarePrice)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="div">
                          Additional to Plan Price
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.75}
                        sx={{ justifyContent: 'flex-end', whiteSpace: 'nowrap' }}
                      >
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<EditOutlinedIcon />}
                          onClick={() => onEditPlan(plan)}
                          disabled={!canManage || submitting}
                          disableElevation
                        >
                          Plan price
                        </Button>
                        {separateHardwarePrice && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<ConstructionRoundedIcon />}
                            onClick={() => onEditHardware(plan)}
                            disabled={!canManage || submitting || !hasPrice(plan.price)}
                          >
                            Hardware
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>

                  {!expanded ? null : planOptions.length > 0 ? planOptions.map((option, optionIndex) => (
                    <TableRow
                      key={option.id}
                      hover
                      sx={{
                        bgcolor: optionIndex % 2 === 0 ? 'background.paper' : 'action.hover',
                        '& td': { py: 1.15 },
                      }}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Box sx={{ width: 14, borderTop: 1, borderColor: 'divider' }} />
                          <Typography variant="body2" color="text.secondary" fontWeight={650}>
                            Option
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          sx={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {option.code}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                          {option.description}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <OptionPriceValue option={option} />
                        <Typography variant="caption" color="text.secondary" component="div">
                          Option price
                        </Typography>
                      </TableCell>
                      {separateHardwarePrice && (
                        <TableCell>
                          <Typography color="text.disabled">—</Typography>
                        </TableCell>
                      )}
                      <TableCell align="right">
                        <Button
                          size="small"
                          color="inherit"
                          startIcon={<EditOutlinedIcon />}
                          onClick={() => onEditOption(plan, option)}
                          disabled={!canManage || submitting}
                        >
                          Edit price
                        </Button>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow key={`${plan.id}-empty-options`}>
                      <TableCell colSpan={columnCount} sx={{ py: 1.5, bgcolor: 'background.default' }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            No Options in this Plan yet.
                          </Typography>
                          <Button
                            component={RouterLink}
                            to={jobPlansOptionsPath(builderId, jobId)}
                            size="small"
                            variant="text"
                          >
                            Manage job options
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  )
}

function JobPricingSelector({
  jobs,
  filteredJobs,
  search,
  loading,
  error,
  onSearchChange,
  onSelectJob,
  onRetry,
}) {
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
        {error && (
          <Alert
            severity="error"
            action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}
            sx={{ mb: 2.5 }}
          >
            {error}
          </Alert>
        )}
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

          {loading ? (
            <Box sx={{ py: 7, px: 3, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
              <Typography color="text.secondary">Loading Jobs, Plans and Options...</Typography>
            </Box>
          ) : filteredJobs.length > 0 ? (
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
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    jobs,
    loading,
    error,
    canManageJobs,
    refreshJobs,
    saveJobPlanPrice,
    savePlanOptionPrice,
  } = useJobs()
  const { refreshDrawInvoicePackages } = useDrawInvoicePackages()
  const { builderDrawSchedules } = useBuilderDrawSchedules()
  const { people } = usePeople()
  const { contacts: builderContacts } = useBuilderContacts()
  const [search, setSearch] = useState('')
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
    const selectedBuilderId = getJobBuilderId(selectedJob)
    if (!selectedJob || selectedBuilderId == null) return

    navigate(jobPlanPricingPath(selectedBuilderId, selectedJob.id))
  }

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
        filteredJobs={filteredJobs}
        search={search}
        loading={loading}
        error={error}
        onSearchChange={setSearch}
        onSelectJob={selectJob}
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
            <PlanPricingSheet
              builderId={resolvedBuilderId}
              jobId={job.id}
              plans={plans}
              canManage={canManagePricing}
              submitting={submitting}
              separateHardwarePrice={separateHardwarePrice}
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
          key={`${phasePriceDialog.planId ?? ''}-${phasePriceDialog.optionId ?? ''}-${phasePriceDialog.components ?? 'ALL'}`}
          job={job}
          filter={phasePriceDialog}
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
