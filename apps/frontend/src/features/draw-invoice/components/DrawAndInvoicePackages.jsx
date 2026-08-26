import { useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
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
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import JobModuleNavigation from '../../jobs/components/JobModuleNavigation.jsx'
import { useJobs } from '../../jobs/context/useJobs.js'
import {
  getJobBuilderId,
  jobBelongsToBuilder,
  jobDrawInvoicePath,
  jobPlanPricingPath,
  jobSequenceSheetPath,
} from '../../jobs/utils/jobRoutes.js'
import {
  formatBuilding,
  formatPhase,
} from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import { buildDrawWorksheet } from '../utils/drawWorksheet.js'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

function formatCurrency(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? currencyFormatter.format(value)
    : '—'
}

function formatPercentage(value) {
  const percentage = Number(value) || 0
  return Number.isInteger(percentage)
    ? String(percentage)
    : percentage.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatBilledDate(value) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  })
}

function billingRecordKey(jobId, phaseId, lotId, drawIndex) {
  return `${jobId}:${phaseId}:${lotId}:${drawIndex}`
}

function readinessLabel(worksheet) {
  if (!worksheet.hasSchedule) return 'Schedule missing'
  if (!worksheet.scheduleIsValid) return 'Schedule needs review'
  if (worksheet.rows.length === 0) return 'No lots'
  if (worksheet.missingPlanCount > 0) return 'Plan missing'
  if (worksheet.unpricedLotCount > 0) return 'Pricing incomplete'
  if (worksheet.missingHardwarePriceCount > 0) return 'Hardware pricing incomplete'
  if (worksheet.invalidHardwarePriceCount > 0) return 'Hardware pricing invalid'
  return 'Ready'
}

function ReadinessChip({ worksheet }) {
  const ready = worksheet.isReady

  return (
    <Chip
      size="small"
      color={ready ? 'success' : 'warning'}
      variant={ready ? 'filled' : 'outlined'}
      icon={ready ? <CheckCircleRoundedIcon /> : <WarningAmberRoundedIcon />}
      label={readinessLabel(worksheet)}
      sx={{ fontWeight: 750 }}
    />
  )
}

function MetricCard({ icon, label, value, detail }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 190, flex: 1 }}>
      <CardContent sx={{ display: 'flex', gap: 1.5, p: '16px !important' }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'primary.light',
            color: 'primary.main',
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {label}
          </Typography>
          {detail && (
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              {detail}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}

function BillingDetailsDialog({ target, onClose, onSave, onClear }) {
  const [invoiceNumber, setInvoiceNumber] = useState(
    target.record?.invoiceNumber ?? '',
  )
  const [dateBilled, setDateBilled] = useState(target.record?.dateBilled ?? '')
  const canSave = invoiceNumber.trim().length > 0 && dateBilled.length > 0
  const draw = target.draw
  const isHardware = target.type === 'hardware'

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={750}>
          {isHardware
            ? 'Hardware billing details'
            : `Draw ${target.drawIndex + 1} billing details`}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Lot {target.row.lotNumber} · Plan {target.row.planCode} ·{' '}
          {formatCurrency(target.amount)}
          {isHardware
            ? ' · Hardware 100%'
            : draw?.name?.trim()
              ? ` · ${draw.name.trim()}`
              : ''}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2}>
          <TextField
            autoFocus
            label="Invoice number"
            value={invoiceNumber}
            onChange={(event) => setInvoiceNumber(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 80 } }}
            fullWidth
          />
          <TextField
            label="Date billed"
            type="date"
            value={dateBilled}
            onChange={(event) => setDateBilled(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {target.record && (
          <Button color="error" onClick={onClear} sx={{ mr: 'auto' }}>
            Clear details
          </Button>
        )}
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disableElevation
          disabled={!canSave}
          onClick={() => onSave({ invoiceNumber: invoiceNumber.trim(), dateBilled })}
        >
          Save billing details
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function DrawWorksheetTable({ job, phase, worksheet, billingRecords, onEditBilling }) {
  const minimumWidth = 300 + worksheet.draws.length * 230


  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2, bgcolor: 'action.hover' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography fontWeight={800}>Draw worksheet</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Every lot uses its assigned plan price and the builder&apos;s active draw allocation.
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            label={`${worksheet.rows.length} ${worksheet.rows.length === 1 ? 'lot' : 'lots'}`}
          />
        </Stack>
      </Box>
      <Divider />
      <TableContainer>
        <Table
          size="medium"
          aria-label={`${formatPhase(phase.name)} ${formatBuilding(phase.building)} draw worksheet`}
          sx={{
            minWidth: minimumWidth,
            '& .MuiTableCell-root': {
              px: 1.2,
              py: 1,
              fontSize: 12.25,
              lineHeight: 1.25,
            },
            '& .MuiTypography-root': {
              fontSize: 12.25,
              lineHeight: 1.25,
            },
            '& .MuiButton-root': {
              minWidth: 0,
              px: 0.75,
              py: 0.4,
              fontSize: 11,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            },
            '& .MuiButton-startIcon': {
              mr: 0.4,
              '& svg': { fontSize: 15 },
            },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell rowSpan={2} sx={{ width: 60, fontWeight: 800 }}>Lot</TableCell>
              <TableCell rowSpan={2} sx={{ width: 72, fontWeight: 800 }}>Plan</TableCell>
              <TableCell rowSpan={2} align="right" sx={{ width: 115, fontWeight: 800 }}>
                {worksheet.separateHardwarePrice ? 'Draw base / lot' : 'Price per lot'}
              </TableCell>
              {worksheet.draws.map((draw, drawIndex) => (
                <TableCell
                  key={`draw-heading-${drawIndex}`}
                  colSpan={2}
                  align="center"
                  sx={{ borderLeft: 1, borderColor: 'divider', bgcolor: 'primary.light' }}
                >
                  <Typography color="primary.main" fontWeight={850}>
                    Draw #{drawIndex + 1}
                    {draw.name?.trim() ? ` · ${draw.name.trim()}` : ''}
                  </Typography>
                  <Typography variant="caption" color="primary.main" fontWeight={750}>
                    {formatPercentage(draw.percentage)}%
                  </Typography>
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              {worksheet.draws.flatMap((_, drawIndex) => [
                <TableCell
                  key={`amount-heading-${drawIndex}`}
                  align="right"
                  sx={{ width: 98, borderLeft: 1, borderColor: 'divider', fontWeight: 750 }}
                >
                  Amount
                </TableCell>,
                <TableCell key={`invoice-heading-${drawIndex}`} sx={{ width: 132, fontWeight: 750 }}>
                  Invoice / Date billed
                </TableCell>,
              ])}
            </TableRow>
          </TableHead>
          <TableBody>
            {worksheet.rows.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>
                  <Typography color="error.main" fontWeight={850}>{row.lotNumber}</Typography>
                </TableCell>
                <TableCell>
                  {row.plan ? (
                    <Box>
                      <Typography fontWeight={750}>{row.planCode}</Typography>
                      {row.lot.reverse && (
                        <Typography variant="caption" color="text.secondary">Reverse</Typography>
                      )}
                    </Box>
                  ) : (
                    <Chip size="small" color="error" variant="outlined" label="Missing" />
                  )}
                </TableCell>
                <TableCell align="right">
                  {row.drawBasePrice == null ? (
                    <Chip size="small" color="warning" variant="outlined" label="Not priced" />
                  ) : (
                    <Box>
                      <Typography fontWeight={750}>
                        {formatCurrency(row.drawBasePrice)}
                      </Typography>
                      {worksheet.separateHardwarePrice && (
                        <Typography variant="caption" color="text.secondary">
                          {formatCurrency(row.basePrice)} total
                        </Typography>
                      )}
                    </Box>
                  )}
                </TableCell>
                {worksheet.draws.flatMap((draw, drawIndex) => {
                  const key = billingRecordKey(job.id, phase.id, row.id, drawIndex)
                  const record = billingRecords[key]
                  const amount = row.drawAmounts[drawIndex]

                  return [
                    <TableCell
                      key={`${key}-amount`}
                      align="right"
                      sx={{ borderLeft: 1, borderColor: 'divider' }}
                    >
                      <Typography fontWeight={850}>{formatCurrency(amount)}</Typography>
                    </TableCell>,
                    <TableCell key={`${key}-billing`}>
                      <Button
                        size="small"
                        color={record ? 'primary' : 'inherit'}
                        variant={record ? 'text' : 'outlined'}
                        startIcon={record ? <EditOutlinedIcon /> : <AddRoundedIcon />}
                        disabled={amount == null}
                        onClick={() => onEditBilling({
                          key,
                          row,
                          draw,
                          drawIndex,
                          amount,
                          record,
                        })}
                        sx={{ textAlign: 'left', justifyContent: 'flex-start' }}
                      >
                        {record ? (
                          <Box component="span">
                            <Box component="span" sx={{ display: 'block', fontWeight: 750 }}>
                              {record.invoiceNumber}
                            </Box>
                            <Box component="span" sx={{ display: 'block', fontSize: 11, color: 'text.secondary' }}>
                              {formatBilledDate(record.dateBilled)}
                            </Box>
                          </Box>
                        ) : 'Add details'}
                      </Button>
                    </TableCell>,
                  ]
                })}
              </TableRow>
            ))}
          </TableBody>
          {worksheet.separateHardwarePrice && worksheet.rows.length > 0 && (
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={2}
                  sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}
                >
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <ConstructionRoundedIcon sx={{ fontSize: 16 }} />
                    <Typography fontWeight={900} color="inherit">
                      HW · Hardware
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 900 }}
                >
                  100%
                </TableCell>
                <TableCell
                  colSpan={worksheet.draws.length * 2}
                  sx={{ bgcolor: 'primary.light', color: 'primary.main', fontWeight: 750 }}
                >
                  Billed separately from the draw allocation
                </TableCell>
              </TableRow>
              {worksheet.rows.map((row) => {
                const key = billingRecordKey(job.id, phase.id, row.id, 'hardware')
                const record = billingRecords[key]

                return (
                  <TableRow key={`${row.id}-hardware`} hover>
                    <TableCell>
                      <Typography color="error.main" fontWeight={850}>
                        {row.lotNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={750}>{row.planCode ?? '—'}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      {row.hardwarePrice == null ? (
                        <Chip
                          size="small"
                          color="warning"
                          variant="outlined"
                          label="Not priced"
                        />
                      ) : (
                        <Typography fontWeight={850}>
                          {formatCurrency(row.hardwarePrice)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell colSpan={worksheet.draws.length * 2}>
                      <Button
                        size="small"
                        color={record ? 'primary' : 'inherit'}
                        variant={record ? 'text' : 'outlined'}
                        startIcon={record ? <EditOutlinedIcon /> : <AddRoundedIcon />}
                        disabled={row.hardwarePrice == null}
                        onClick={() => onEditBilling({
                          type: 'hardware',
                          key,
                          row,
                          amount: row.hardwarePrice,
                          record,
                        })}
                      >
                        {record
                          ? `${record.invoiceNumber} · ${formatBilledDate(record.dateBilled)}`
                          : 'Add hardware invoice details'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          )}
          {worksheet.rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>
                  <Typography fontWeight={850}>
                    {worksheet.separateHardwarePrice ? 'Draw total' : 'Package total'}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={850}>
                    {formatCurrency(worksheet.totalDrawBasePrice)}
                  </Typography>
                </TableCell>
                {worksheet.draws.flatMap((_, drawIndex) => {
                  const billedCount = worksheet.rows.filter((row) =>
                    Boolean(billingRecords[
                      billingRecordKey(job.id, phase.id, row.id, drawIndex)
                    ]),
                  ).length

                  return [
                    <TableCell
                      key={`total-draw-${drawIndex}`}
                      align="right"
                      sx={{ borderLeft: 1, borderColor: 'divider' }}
                    >
                      <Typography fontWeight={900} color="text.primary">
                        {formatCurrency(worksheet.drawTotals[drawIndex])}
                      </Typography>
                    </TableCell>,
                    <TableCell key={`total-billed-${drawIndex}`}>
                      <Typography variant="caption" color="text.secondary">
                        {billedCount} / {worksheet.rows.length} billed
                      </Typography>
                    </TableCell>,
                  ]
                })}
              </TableRow>
              {worksheet.separateHardwarePrice && (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Typography fontWeight={850}>Hardware total · 100%</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontWeight={900} color="text.primary">
                      {formatCurrency(worksheet.totalHardwarePrice)}
                    </Typography>
                  </TableCell>
                  <TableCell colSpan={worksheet.draws.length * 2}>
                    <Typography variant="caption" color="text.secondary">
                      {worksheet.rows.filter((row) => Boolean(billingRecords[
                        billingRecordKey(job.id, phase.id, row.id, 'hardware')
                      ])).length} / {worksheet.rows.length} billed
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {worksheet.separateHardwarePrice && (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Typography fontWeight={900}>Contract total</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontWeight={900} color="text.primary">
                      {formatCurrency(worksheet.totalBasePrice)}
                    </Typography>
                  </TableCell>
                  <TableCell colSpan={worksheet.draws.length * 2} />
                </TableRow>
              )}
            </TableFooter>
          )}
        </Table>
      </TableContainer>
      {worksheet.rows.length === 0 && (
        <Box sx={{ p: 5, textAlign: 'center' }}>
          <ApartmentRoundedIcon color="disabled" sx={{ fontSize: 40 }} />
          <Typography fontWeight={750} sx={{ mt: 1 }}>No lots assigned</Typography>
          <Typography variant="body2" color="text.secondary">
            Add lots to this phase from its Sequence Sheet.
          </Typography>
        </Box>
      )}
    </Card>
  )
}

function PackageCatalog({ jobs, schedules, onOpen }) {
  const [search, setSearch] = useState('')
  const packages = useMemo(
    () => jobs.flatMap((job) => {
      const schedule = schedules.find((item) =>
        String(item.builderId) === String(getJobBuilderId(job)),
      )

      return (job.sequenceSheet?.phases ?? []).map((phase) => ({
        job,
        phase,
        worksheet: buildDrawWorksheet(job, phase, schedule),
      }))
    }),
    [jobs, schedules],
  )
  const normalizedSearch = search.trim().toLowerCase()
  const filteredPackages = packages.filter(({ job, phase }) =>
    [job.code, job.builder, job.community, phase.name, phase.building]
      .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
  )

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
        <Typography variant="overline" color="primary.main" fontWeight={800}>
          Draw & Invoice Packages
        </Typography>
        <Typography variant="h5" fontWeight={800}>Choose a draw package</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>
          Packages are built from each Job phase, its assigned lots and plan prices,
          then allocated with the builder&apos;s Draw Schedule.
        </Typography>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <TextField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by Job#, builder, project, phase or building"
          fullWidth
          sx={{ mb: 2 }}
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

        <Stack spacing={1.5}>
          {filteredPackages.map(({ job, phase, worksheet }) => (
            <Card key={`${job.id}-${phase.id}`} variant="outlined">
              <CardContent sx={{ p: '20px !important' }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Box
                      sx={{
                        width: 46,
                        height: 46,
                        flexShrink: 0,
                        borderRadius: 1.5,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: 'primary.light',
                        color: 'primary.main',
                      }}
                    >
                      <ReceiptLongRoundedIcon />
                    </Box>
                    <Box>
                      <Typography fontWeight={850}>
                        Job #{job.code} · {formatPhase(phase.name)} / {formatBuilding(phase.building)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {job.builder} · {job.community}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { sm: 'center' } }}
                  >
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <ReadinessChip worksheet={worksheet} />
                      <Chip size="small" variant="outlined" label={`${worksheet.rows.length} lots`} />
                      {worksheet.rows.length > 0 && (
                        <Chip size="small" variant="outlined" label={formatCurrency(worksheet.totalBasePrice)} />
                      )}
                    </Stack>
                    <Button
                      variant="contained"
                      endIcon={<ArrowForwardRoundedIcon />}
                      onClick={() => onOpen(job, phase)}
                      disableElevation
                    >
                      Open package
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>

        {filteredPackages.length === 0 && (
          <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
            <ReceiptLongRoundedIcon color="disabled" sx={{ fontSize: 42 }} />
            <Typography fontWeight={750} sx={{ mt: 1 }}>No draw packages found</Typography>
            <Typography variant="body2" color="text.secondary">
              A Job needs at least one phase with assigned lots before a package appears here.
            </Typography>
          </Card>
        )}
      </Box>
    </Box>
  )
}

export default function DrawAndInvoicePackages() {
  const navigate = useNavigate()
  const { builderId, jobId, phaseId } = useParams()
  const { jobs } = useJobs()
  const { builderDrawSchedules } = useBuilderDrawSchedules()
  const [billingRecords, setBillingRecords] = useState({})
  const [billingTarget, setBillingTarget] = useState(null)

  const focusedJob = jobId == null
    ? null
    : jobs.find((job) =>
        String(job.id) === String(jobId)
        && jobBelongsToBuilder(job, builderId),
      )

  if (jobId == null) {
    return (
      <PackageCatalog
        jobs={jobs}
        schedules={builderDrawSchedules}
        onOpen={(job, phase) => navigate(
          jobDrawInvoicePath(getJobBuilderId(job), job.id, phase.id),
        )}
      />
    )
  }

  if (!focusedJob) {
    return (
      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Alert
          severity="error"
          action={<Button color="inherit" onClick={() => navigate('/draw-invoice')}>All packages</Button>}
        >
          This Job does not exist or does not belong to the selected builder.
        </Alert>
      </Box>
    )
  }

  const phases = focusedJob.sequenceSheet?.phases ?? []
  const selectedPhase = phases.find((phase) => String(phase.id) === String(phaseId))
    ?? phases[0]
  const focusedBuilderId = getJobBuilderId(focusedJob)
  const schedule = builderDrawSchedules.find(
    (item) => String(item.builderId) === String(focusedBuilderId),
  )
  const worksheet = buildDrawWorksheet(focusedJob, selectedPhase, schedule)

  const handlePhaseChange = (event) => {
    navigate(jobDrawInvoicePath(focusedBuilderId, focusedJob.id, event.target.value))
  }

  const handleSaveBilling = (record) => {
    setBillingRecords((current) => ({
      ...current,
      [billingTarget.key]: record,
    }))
    setBillingTarget(null)
  }

  const handleClearBilling = () => {
    setBillingRecords((current) => {
      const next = { ...current }
      delete next[billingTarget.key]
      return next
    })
    setBillingTarget(null)
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 2.5,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Button
          color="inherit"
          startIcon={<ArrowBackRoundedIcon />}
          onClick={() => navigate('/draw-invoice')}
          sx={{ mb: 1.5 }}
        >
          All draw packages
        </Button>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="overline" color="primary.main" fontWeight={800}>
              {focusedJob.builder} / {focusedJob.community}
            </Typography>
            <Typography variant="h5" fontWeight={850}>
              Job #{focusedJob.code} · Draw package
            </Typography>
            {selectedPhase && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {formatPhase(selectedPhase.name)} · {formatBuilding(selectedPhase.building)}
              </Typography>
            )}
          </Box>
          <ReadinessChip worksheet={worksheet} />
        </Stack>
      </Box>

      <JobModuleNavigation
        active="draw-invoice"
        builderId={focusedBuilderId}
        jobId={focusedJob.id}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {phases.length === 0 ? (
          <Alert
            severity="info"
            action={(
              <Button
                component={RouterLink}
                to={jobSequenceSheetPath(focusedBuilderId, focusedJob.id)}
                color="inherit"
              >
                Open Sequence Sheet
              </Button>
            )}
          >
            This Job has no phases yet. Create a phase and assign its lots first.
          </Alert>
        ) : (
          <Stack spacing={2.5}>
            <Card variant="outlined">
              <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
                >
                  <Box>
                    <Typography fontWeight={800}>Package scope</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Choose the phase and building whose lots should be included.
                    </Typography>
                  </Box>
                  <TextField
                    select
                    label="Phase / Building"
                    value={selectedPhase?.id ?? ''}
                    onChange={handlePhaseChange}
                    sx={{ minWidth: { xs: '100%', md: 280 } }}
                  >
                    {phases.map((phase) => (
                      <MenuItem key={phase.id} value={phase.id}>
                        {formatPhase(phase.name)} · {formatBuilding(phase.building)} ·{' '}
                        {phase.lots?.length ?? 0} lots
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </CardContent>
            </Card>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <MetricCard
                icon={<ApartmentRoundedIcon />}
                label="Lots in package"
                value={worksheet.rows.length}
                detail={`${formatPhase(selectedPhase.name)} · ${formatBuilding(selectedPhase.building)}`}
              />
              <MetricCard
                icon={<AttachMoneyRoundedIcon />}
                label="Base contract value"
                value={formatCurrency(worksheet.totalBasePrice)}
                detail={worksheet.unpricedLotCount > 0 ? `${worksheet.unpricedLotCount} unpriced` : 'All plan prices included'}
              />
              {worksheet.separateHardwarePrice && (
                <MetricCard
                  icon={<ConstructionRoundedIcon />}
                  label="Hardware · 100%"
                  value={formatCurrency(worksheet.totalHardwarePrice)}
                  detail={`${formatCurrency(worksheet.totalDrawBasePrice)} remains for draws`}
                />
              )}
              <MetricCard
                icon={<LayersRoundedIcon />}
                label="Builder draw allocation"
                value={schedule ? `${schedule.draws.length} draws` : 'Not configured'}
                detail={schedule
                  ? `${schedule.draws.map((draw) => `${formatPercentage(draw.percentage)}%`).join(' / ')}${schedule.separateHardwarePrice ? ' + HW 100%' : ''}`
                  : focusedJob.builder}
              />
            </Stack>

            {!worksheet.hasSchedule && (
              <Alert
                severity="warning"
                action={(
                  <Button component={RouterLink} to="/builder-draw-schedules" color="inherit">
                    Configure schedule
                  </Button>
                )}
              >
                {focusedJob.builder} does not have a Builder Draw Schedule. Amounts cannot be allocated yet.
              </Alert>
            )}
            {worksheet.hasSchedule && !worksheet.scheduleIsValid && (
              <Alert severity="error">
                The builder&apos;s draw percentages must be positive and total exactly 100%.
              </Alert>
            )}
            {(worksheet.missingPlanCount > 0 || worksheet.unpricedLotCount > 0) && (
              <Alert
                severity="warning"
                action={(
                  <Button
                    component={RouterLink}
                    to={jobPlanPricingPath(focusedBuilderId, focusedJob.id)}
                    color="inherit"
                  >
                    Open pricing
                  </Button>
                )}
              >
                {worksheet.missingPlanCount > 0
                  ? `${worksheet.missingPlanCount} lot assignment${worksheet.missingPlanCount === 1 ? '' : 's'} reference a missing plan. `
                  : ''}
                {worksheet.unpricedLotCount > 0
                  ? `${worksheet.unpricedLotCount} lot${worksheet.unpricedLotCount === 1 ? '' : 's'} use a plan without a base price.`
                  : ''}
              </Alert>
            )}
            {(worksheet.missingHardwarePriceCount > 0
              || worksheet.invalidHardwarePriceCount > 0) && (
              <Alert
                severity="warning"
                action={(
                  <Button
                    component={RouterLink}
                    to={jobPlanPricingPath(focusedBuilderId, focusedJob.id)}
                    color="inherit"
                  >
                    Open pricing
                  </Button>
                )}
              >
                {worksheet.missingHardwarePriceCount > 0
                  ? `${worksheet.missingHardwarePriceCount} lot${worksheet.missingHardwarePriceCount === 1 ? '' : 's'} use a plan without a hardware price. `
                  : ''}
                {worksheet.invalidHardwarePriceCount > 0
                  ? `${worksheet.invalidHardwarePriceCount} hardware price${worksheet.invalidHardwarePriceCount === 1 ? '' : 's'} exceed the plan price.`
                  : ''}
              </Alert>
            )}

            <DrawWorksheetTable
              job={focusedJob}
              phase={selectedPhase}
              worksheet={worksheet}
              billingRecords={billingRecords}
              onEditBilling={setBillingTarget}
            />
          </Stack>
        )}
      </Box>

      {billingTarget && (
        <BillingDetailsDialog
          key={billingTarget.key}
          target={billingTarget}
          onClose={() => setBillingTarget(null)}
          onSave={handleSaveBilling}
          onClear={handleClearBilling}
        />
      )}
    </Box>
  )
}
