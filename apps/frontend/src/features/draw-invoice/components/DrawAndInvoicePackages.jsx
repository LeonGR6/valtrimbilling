import { useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
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
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
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
import { useDrawInvoicePackages } from '../context/useDrawInvoicePackages.js'
import {
  buildUsedDrawSelections,
  drawSelectionKey,
  makePackageSelections,
  summarizeDrawPackage,
} from '../utils/drawPackages.js'
import { buildDrawWorksheet } from '../utils/drawWorksheet.js'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const packageTableColumns = [
  { key: 'package', width: 220 },
  { key: 'builder', width: 180 },
  { key: 'billing-period', width: 130 },
  { key: 'lots', width: 105 },
  { key: 'current-draw', width: 135 },
  { key: 'retention-wrap', width: 180 },
  { key: 'invoice-amount', width: 140 },
  { key: 'documents', width: 110 },
  { key: 'quickbooks', width: 115 },
  { key: 'submission', width: 115 },
  { key: 'status', width: 120 },
  { key: 'action', width: 90 },
]

const packageTableMinimumWidth = packageTableColumns.reduce(
  (total, column) => total + column.width,
  0,
)

const packageStatusLabels = {
  DRAFT: 'Draft',
  READY: 'Ready',
  INVOICED: 'Invoiced',
  SUBMITTED: 'Submitted',
  PAID: 'Paid',
  VOIDED: 'Voided',
}

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

function formatDate(value) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatBillingPeriod(record) {
  if (!record.billingPeriodStart || !record.billingPeriodEnd) return 'Not set'
  return `${formatDate(record.billingPeriodStart)} – ${formatDate(record.billingPeriodEnd)}`
}

function readinessLabel(worksheet) {
  if (!worksheet.hasSchedule) return 'Schedule missing'
  if (!worksheet.scheduleIsValid) return 'Schedule needs review'
  if (worksheet.rows.length === 0) return 'No lots'
  if (worksheet.missingPlanCount > 0) return 'Plan missing'
  if (worksheet.unpricedLotCount > 0) return 'Pricing incomplete'
  if (worksheet.missingHardwarePriceCount > 0)
    return 'Hardware pricing incomplete'
  if (worksheet.invalidHardwarePriceCount > 0)
    return 'Hardware pricing invalid'
  return 'Ready'
}

function ReadinessChip({ worksheet }) {
  return (
    <Chip
      size="small"
      color={worksheet.isReady ? 'success' : 'warning'}
      variant={worksheet.isReady ? 'filled' : 'outlined'}
      icon={
        worksheet.isReady ? (
          <CheckCircleRoundedIcon />
        ) : (
          <WarningAmberRoundedIcon />
        )
      }
      label={readinessLabel(worksheet)}
      sx={{ fontWeight: 750 }}
    />
  )
}

function PackageStatusChip({ status }) {
  const color =
    status === 'PAID' || status === 'SUBMITTED'
      ? 'success'
      : status === 'VOIDED'
        ? 'default'
        : status === 'DRAFT'
          ? 'warning'
          : 'primary'

  return (
    <Chip
      size="small"
      color={color}
      variant={status === 'DRAFT' ? 'outlined' : 'filled'}
      label={packageStatusLabels[status] ?? status}
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
            <Typography variant="caption" color="text.secondary" component="div">
              {detail}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}

function getPackageContext(record, jobs, schedules) {
  const job = jobs.find((candidate) => String(candidate.id) === String(record.jobId))
  const phase = job?.sequenceSheet?.phases?.find(
    (candidate) => String(candidate.id) === String(record.phaseId),
  )
  const schedule = schedules.find(
    (candidate) =>
      String(candidate.builderId) === String(getJobBuilderId(job)),
  )

  if (!job || !phase) return null
  return {
    record,
    job,
    phase,
    schedule,
    summary: summarizeDrawPackage(record, job, phase, schedule),
  }
}

function CreateDrawDialog({
  jobs,
  schedules,
  packages,
  initialJobId,
  initialPhaseId,
  onClose,
  onCreate,
}) {
  const firstJob =
    jobs.find((job) => String(job.id) === String(initialJobId)) ??
    jobs.find((job) => (job.sequenceSheet?.phases?.length ?? 0) > 0)
  const [selectedJobId, setSelectedJobId] = useState(
    firstJob == null ? '' : String(firstJob.id),
  )
  const initialJob = jobs.find(
    (job) => String(job.id) === String(selectedJobId),
  )
  const firstPhase =
    initialJob?.sequenceSheet?.phases?.find(
      (phase) => String(phase.id) === String(initialPhaseId),
    ) ?? initialJob?.sequenceSheet?.phases?.[0]
  const [selectedPhaseId, setSelectedPhaseId] = useState(
    firstPhase == null ? '' : String(firstPhase.id),
  )
  const [selectedLotIds, setSelectedLotIds] = useState([])
  const [selectedDrawIndexes, setSelectedDrawIndexes] = useState([])

  const job = jobs.find((candidate) => String(candidate.id) === selectedJobId)
  const phases = job?.sequenceSheet?.phases ?? []
  const phase = phases.find(
    (candidate) => String(candidate.id) === selectedPhaseId,
  )
  const schedule = schedules.find(
    (candidate) =>
      String(candidate.builderId) === String(getJobBuilderId(job)),
  )
  const worksheet = buildDrawWorksheet(job, phase, schedule)
  const usedSelections = useMemo(
    () => buildUsedDrawSelections(packages),
    [packages],
  )
  const selectedLotIdSet = new Set(selectedLotIds.map(String))
  const selectedDrawIndexSet = new Set(selectedDrawIndexes)

  const selectionIsUsed = (lotId, drawIndex) =>
    usedSelections.has(
      drawSelectionKey(job?.id, phase?.id, lotId, drawIndex),
    )

  const lotConflictsWithSelectedDraws = (lotId) =>
    selectedDrawIndexes.some((drawIndex) => selectionIsUsed(lotId, drawIndex))

  const lotHasAvailableDraw = (lotId) =>
    worksheet.draws.some((_, drawIndex) => !selectionIsUsed(lotId, drawIndex))

  const handleJobChange = (event) => {
    const nextJobId = event.target.value
    const nextJob = jobs.find((candidate) => String(candidate.id) === nextJobId)
    setSelectedJobId(nextJobId)
    setSelectedPhaseId(
      nextJob?.sequenceSheet?.phases?.[0]?.id == null
        ? ''
        : String(nextJob.sequenceSheet.phases[0].id),
    )
    setSelectedLotIds([])
    setSelectedDrawIndexes([])
  }

  const handlePhaseChange = (event) => {
    setSelectedPhaseId(event.target.value)
    setSelectedLotIds([])
    setSelectedDrawIndexes([])
  }

  const toggleLot = (lotId) => {
    setSelectedLotIds((current) =>
      current.some((value) => String(value) === String(lotId))
        ? current.filter((value) => String(value) !== String(lotId))
        : [...current, lotId],
    )
  }

  const toggleDraw = (drawIndex) => {
    setSelectedDrawIndexes((current) =>
      current.includes(drawIndex)
        ? current.filter((value) => value !== drawIndex)
        : [...current, drawIndex].sort((left, right) => left - right),
    )
  }

  const draftRecord = {
    lotIds: selectedLotIds,
    drawIndexes: selectedDrawIndexes,
    optionsBillingDrawIndex: schedule?.optionsBillingDrawIndex ?? null,
    selections: makePackageSelections(selectedLotIds, selectedDrawIndexes),
  }
  const summary = summarizeDrawPackage(draftRecord, job, phase, schedule)
  const canCreate =
    worksheet.isReady &&
    selectedLotIds.length > 0 &&
    selectedDrawIndexes.length > 0 &&
    summary.unpricedOptionCount === 0

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={800}>
          Create Draw
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          A Draw creates one package with an invoice and its required documents.
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Job"
              value={selectedJobId}
              onChange={handleJobChange}
              fullWidth
            >
              {jobs.map((candidate) => (
                <MenuItem key={candidate.id} value={String(candidate.id)}>
                  Job #{candidate.code} · {candidate.builder} · {candidate.community}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Phase / Building"
              value={selectedPhaseId}
              onChange={handlePhaseChange}
              disabled={phases.length === 0}
              fullWidth
            >
              {phases.map((candidate) => (
                <MenuItem key={candidate.id} value={String(candidate.id)}>
                  {formatPhase(candidate.name)} · {formatBuilding(candidate.building)} ·{' '}
                  {candidate.lots?.length ?? 0} lots
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {!worksheet.isReady && (
            <Alert severity="warning">
              {readinessLabel(worksheet)}. Complete the worksheet prerequisites
              before creating a package.
            </Alert>
          )}

          <Box>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
            >
              <Box>
                <Typography fontWeight={800}>1. Select lots</Typography>
                <Typography variant="body2" color="text.secondary">
                  You can choose any subset of lots in this phase-building.
                </Typography>
              </Box>
              <Chip
                size="small"
                variant="outlined"
                label={`${selectedLotIds.length} selected`}
              />
            </Stack>
            <Card variant="outlined">
              <TableContainer sx={{ maxHeight: 260 }}>
                <Table size="small" stickyHeader aria-label="Lots available for this package">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" />
                      <TableCell>Lot</TableCell>
                      <TableCell>Plan</TableCell>
                      <TableCell>Options</TableCell>
                      <TableCell align="right">Price per lot</TableCell>
                      <TableCell>Availability</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {worksheet.rows.map((row) => {
                      const selected = selectedLotIdSet.has(String(row.id))
                      const unavailable =
                        !lotHasAvailableDraw(row.id) ||
                        lotConflictsWithSelectedDraws(row.id)
                      const availableDrawCount = worksheet.draws.filter(
                        (_, drawIndex) => !selectionIsUsed(row.id, drawIndex),
                      ).length

                      return (
                        <TableRow
                          key={row.id}
                          hover
                          selected={selected}
                          onClick={() => !unavailable && toggleLot(row.id)}
                          sx={{ cursor: unavailable ? 'default' : 'pointer' }}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selected}
                              disabled={unavailable}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleLot(row.id)}
                              inputProps={{ 'aria-label': `Select lot ${row.lotNumber}` }}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography color="error.main" fontWeight={850}>
                              {row.lotNumber}
                            </Typography>
                          </TableCell>
                          <TableCell>{row.planCode ?? '—'}</TableCell>
                          <TableCell>
                            {(row.selectedOptions?.length ?? 0) > 0 ? (
                              <Chip
                                size="small"
                                variant="outlined"
                                label={`${row.selectedOptions.length} selected`}
                              />
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                None
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {formatCurrency(row.drawBasePrice)}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {availableDrawCount} of {worksheet.draws.length} draws available
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Box>

          <Box>
            <Typography fontWeight={800}>2. Select one or more draws</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Each selected draw will be included for every selected lot.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              {worksheet.draws.map((draw, drawIndex) => {
                const conflictCount = selectedLotIds.filter((lotId) =>
                  selectionIsUsed(lotId, drawIndex),
                ).length
                const disabled = selectedLotIds.length === 0 || conflictCount > 0
                const selected = selectedDrawIndexSet.has(drawIndex)

                return (
                  <Card
                    key={drawIndex}
                    variant="outlined"
                    onClick={() => !disabled && toggleDraw(drawIndex)}
                    sx={{
                      flex: 1,
                      cursor: disabled ? 'default' : 'pointer',
                      borderColor: selected ? 'primary.main' : 'divider',
                      bgcolor: selected ? 'primary.light' : 'background.paper',
                      opacity: disabled ? 0.65 : 1,
                    }}
                  >
                    <CardContent sx={{ p: '12px !important' }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start' }}>
                        <Checkbox
                          checked={selected}
                          disabled={disabled}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleDraw(drawIndex)}
                          sx={{ p: 0 }}
                          inputProps={{ 'aria-label': `Select draw ${drawIndex + 1}` }}
                        />
                        <Box>
                          <Typography fontWeight={850}>Draw #{drawIndex + 1}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {formatPercentage(draw.percentage)}%
                            {draw.name?.trim() ? ` · ${draw.name.trim()}` : ''}
                          </Typography>
                          {conflictCount > 0 && (
                            <Typography variant="caption" color="warning.main">
                              Used for {conflictCount} selected lot{conflictCount === 1 ? '' : 's'}
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                )
              })}
            </Stack>
          </Box>

          {summary.optionsAreDue && summary.selectedOptionRows.length > 0 && (
            summary.unpricedOptionCount > 0 ? (
              <Alert
                severity="warning"
                action={job ? (
                  <Button
                    component={RouterLink}
                    to={jobPlanPricingPath(getJobBuilderId(job), job.id)}
                    color="inherit"
                  >
                    Open pricing
                  </Button>
                ) : undefined}
              >
                {summary.unpricedOptionCount} selected{' '}
                {summary.unpricedOptionCount === 1 ? 'option needs' : 'options need'}{' '}
                a price before this package can be created.
              </Alert>
            ) : (
              <Alert severity="success">
                Options are billed with Draw #{summary.optionsBillingDrawIndex + 1}.
                This package will add {formatCurrency(summary.optionsTotal)} in options.
              </Alert>
            )
          )}

          {canCreate && (
            <Card variant="outlined" sx={{ bgcolor: 'action.hover' }}>
              <CardContent sx={{ p: '16px !important' }}>
                <Typography fontWeight={800}>Package preview</Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  useFlexGap
                  sx={{ mt: 1, flexWrap: 'wrap' }}
                >
                  <Typography variant="body2">
                    <strong>{summary.lotCount}</strong> lots ·{' '}
                    <strong>{summary.scopeCount}</strong> lot/draw scopes
                  </Typography>
                  <Typography variant="body2">
                    Current Draw: <strong>{formatCurrency(summary.currentDraw)}</strong>
                  </Typography>
                  {summary.optionsAreDue && (
                    <Typography variant="body2">
                      Options: <strong>{formatCurrency(summary.optionsTotal)}</strong>
                    </Typography>
                  )}
                  <Typography variant="body2">
                    Invoice Amount: <strong>{formatCurrency(summary.invoiceAmount)}</strong>
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          disabled={!canCreate}
          disableElevation
          onClick={() =>
            onCreate({
              jobId: job.id,
              phaseId: phase.id,
              lotIds: selectedLotIds,
              drawIndexes: selectedDrawIndexes,
              schedule,
            })
          }
        >
          Create package
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function DrawWorksheetTable({
  job,
  phase,
  worksheet,
  packages,
  currentPackageId,
}) {
  const minimumWidth = 300 + worksheet.draws.length * 230
  const usedSelections = useMemo(
    () => buildUsedDrawSelections(packages),
    [packages],
  )

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
              Yellow cells are already assigned to an invoice package and cannot
              be selected again.
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
            '& .MuiTableCell-root': { px: 1.2, py: 1, fontSize: 12.25 },
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
                  Package / Invoice
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
                  <Typography fontWeight={750}>{row.planCode ?? '—'}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={750}>{formatCurrency(row.drawBasePrice)}</Typography>
                </TableCell>
                {worksheet.draws.flatMap((_, drawIndex) => {
                  const key = drawSelectionKey(job.id, phase.id, row.id, drawIndex)
                  const owner = usedSelections.get(key)
                  const isCurrent = owner?.id === currentPackageId

                  return [
                    <TableCell
                      key={`${key}-amount`}
                      align="right"
                      sx={{ borderLeft: 1, borderColor: 'divider' }}
                    >
                      <Typography fontWeight={850}>
                        {formatCurrency(row.drawAmounts[drawIndex])}
                      </Typography>
                    </TableCell>,
                    <TableCell
                      key={`${key}-usage`}
                      sx={
                        owner
                          ? {
                              bgcolor: 'warning.light',
                              color: 'warning.contrastText',
                              boxShadow: isCurrent ? 'inset 3px 0 0' : undefined,
                              boxShadowColor: isCurrent ? 'warning.dark' : undefined,
                            }
                          : undefined
                      }
                    >
                      {owner ? (
                        <Box>
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                            <LockRoundedIcon sx={{ fontSize: 14 }} />
                            <Typography variant="caption" fontWeight={850}>
                              {owner.packageNumber}
                            </Typography>
                          </Stack>
                          <Typography variant="caption" component="div">
                            {owner.invoiceNumber
                              ? `${owner.invoiceNumber} · ${formatDate(owner.invoiceDate)}`
                              : 'Invoice pending'}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">Available</Typography>
                      )}
                    </TableCell>,
                  ]
                })}
              </TableRow>
            ))}
          </TableBody>
          {worksheet.rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}><Typography fontWeight={850}>Worksheet total</Typography></TableCell>
                <TableCell align="right"><Typography fontWeight={850}>{formatCurrency(worksheet.totalDrawBasePrice)}</Typography></TableCell>
                {worksheet.draws.flatMap((_, drawIndex) => {
                  const usedCount = worksheet.rows.filter((row) =>
                    usedSelections.has(drawSelectionKey(job.id, phase.id, row.id, drawIndex)),
                  ).length
                  return [
                    <TableCell key={`total-${drawIndex}`} align="right" sx={{ borderLeft: 1, borderColor: 'divider' }}>
                      <Typography fontWeight={900}>{formatCurrency(worksheet.drawTotals[drawIndex])}</Typography>
                    </TableCell>,
                    <TableCell key={`used-${drawIndex}`}>
                      <Typography variant="caption" color="text.secondary">
                        {usedCount} / {worksheet.rows.length} used
                      </Typography>
                    </TableCell>,
                  ]
                })}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableContainer>
    </Card>
  )
}

function PackageOptionsTable({ summary }) {
  const billingDrawLabel = summary.optionsBillingDrawIndex == null
    ? 'Not configured'
    : `Draw #${summary.optionsBillingDrawIndex + 1}`

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2, bgcolor: 'action.hover' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography fontWeight={800}>Options</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Selected lot options are invoiced according to the builder setup.
            </Typography>
          </Box>
          <Chip size="small" variant="outlined" label={`Billing draw · ${billingDrawLabel}`} />
        </Stack>
      </Box>
      <Divider />

      {summary.optionsBillingDrawIndex == null ? (
        <Alert severity="info" sx={{ m: 2 }}>
          This builder does not have an options billing draw configured.
        </Alert>
      ) : summary.selectedOptionRows.length === 0 ? (
        <Alert severity="info" sx={{ m: 2 }}>
          The lots in this package do not contain selected options.
        </Alert>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Options selected for this package">
            <TableHead>
              <TableRow>
                <TableCell>Lot</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>Option</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Billing draw</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.selectedOptionRows.map((option) => {
                const included = summary.optionsAreDue
                const priceMissing = option.issue === 'PRICE_MISSING'

                return (
                  <TableRow key={option.id} hover>
                    <TableCell>
                      <Typography color="error.main" fontWeight={850}>
                        {option.lotNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>{option.planCode ?? '—'}</TableCell>
                    <TableCell><Typography fontWeight={750}>{option.optionCode}</Typography></TableCell>
                    <TableCell>{option.description}</TableCell>
                    <TableCell>{billingDrawLabel}</TableCell>
                    <TableCell align="right">
                      <Typography color={priceMissing ? 'error' : 'text.primary'} fontWeight={750}>
                        {priceMissing ? 'Price missing' : formatCurrency(option.price)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={included && !priceMissing ? 'success' : priceMissing ? 'error' : 'default'}
                        variant={included && !priceMissing ? 'filled' : 'outlined'}
                        label={included
                          ? priceMissing ? 'Needs price' : 'Included in invoice'
                          : `Pending ${billingDrawLabel}`}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            {summary.optionsAreDue && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography fontWeight={850}>Options total</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontWeight={900}>{formatCurrency(summary.optionsTotal)}</Typography>
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableContainer>
      )}
    </Card>
  )
}

function PackageCatalog({ jobs, schedules, packages, onOpen, onCreate }) {
  const [search, setSearch] = useState('')
  const contexts = useMemo(
    () => packages.map((record) => getPackageContext(record, jobs, schedules)).filter(Boolean),
    [jobs, packages, schedules],
  )
  const normalizedSearch = search.trim().toLowerCase()
  const filteredContexts = contexts.filter(({ record, job, phase }) =>
    [
      record.packageNumber,
      record.invoiceNumber,
      job.code,
      job.builder,
      job.community,
      phase.name,
      phase.building,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch)),
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
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="overline" color="primary.main" fontWeight={800}>
              Draw & Invoice Packages
            </Typography>
            <Typography variant="h5" fontWeight={800}>Packages</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>
              Each package contains one invoice for the selected lots and draws,
              plus the documents required by the builder.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={onCreate}
            disableElevation
          >
            Create Draw
          </Button>
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <TextField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search package, invoice, Job#, builder, project, phase or building"
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

        <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <TableContainer>
            <Table sx={{ minWidth: packageTableMinimumWidth, tableLayout: 'fixed' }}>
              <colgroup>
                {packageTableColumns.map((column) => (
                  <col key={column.key} style={{ width: column.width }} />
                ))}
              </colgroup>
              <TableHead>
                <TableRow
                  sx={{
                    bgcolor: 'sidebar.bg',
                    '& .MuiTableCell-root': {
                      color: 'text.secondary',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    },
                  }}
                >
                  <TableCell>Package</TableCell>
                  <TableCell>Builder/Community</TableCell>
                  <TableCell>Billing Period</TableCell>
                  <TableCell>Lots/Scopes</TableCell>
                  <TableCell>Current Draw</TableCell>
                  <TableCell>Retention / WRAP Insurance</TableCell>
                  <TableCell>Invoice Amount</TableCell>
                  <TableCell>Documents</TableCell>
                  <TableCell>QuickBooks</TableCell>
                  <TableCell>Submission</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredContexts.map(({ record, job, phase, summary }) => {
                  const completeDocuments = record.documents.filter(
                    (document) => document.status === 'COMPLETE',
                  ).length
                  return (
                    <TableRow key={record.id} hover>
                      <TableCell>
                        <Typography fontWeight={800}>{record.packageNumber}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Job #{job.code} · {formatPhase(phase.name)} / {formatBuilding(phase.building)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {record.drawIndexes.map((drawIndex) => `Draw ${drawIndex + 1}`).join(', ')}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography color="text.primary">{job.builder}</Typography>
                        <Typography variant="body2" color="text.secondary">{job.community}</Typography>
                      </TableCell>
                      <TableCell>{formatBillingPeriod(record)}</TableCell>
                      <TableCell>
                        <Typography fontWeight={750}>{summary.lotRange}</Typography>
                        <Typography variant="caption" color="text.secondary">{summary.scopeCount} scopes</Typography>
                      </TableCell>
                      <TableCell><Typography fontWeight={750}>{formatCurrency(summary.currentDraw)}</Typography></TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          Retention:{' '}
                          <Typography component="span" variant="inherit" color="error">
                            -{formatCurrency(summary.retention)}
                          </Typography>
                        </Typography>
                        <Typography variant="body2">
                          WRAP:{' '}
                          <Typography component="span" variant="inherit" color="error">
                            -{formatCurrency(summary.wrapInsurance)}
                          </Typography>
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={850}>{formatCurrency(summary.invoiceAmount)}</Typography>
                        {summary.optionsTotal > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            Includes {formatCurrency(summary.optionsTotal)} options
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography>{completeDocuments} of {record.documents.length}</Typography>
                        <Typography variant="caption" color={completeDocuments === record.documents.length ? 'success.main' : 'text.secondary'}>
                          {completeDocuments === record.documents.length ? 'Complete' : 'Pending'}
                        </Typography>
                      </TableCell>
                      <TableCell>{record.quickbooksStatus === 'CREATED' ? 'Created' : 'Not created'}</TableCell>
                      <TableCell>{record.submissionStatus === 'SUBMITTED' ? 'Submitted' : 'Not submitted'}</TableCell>
                      <TableCell><PackageStatusChip status={record.status} /></TableCell>
                      <TableCell>
                        <Button size="small" variant="contained" onClick={() => onOpen(record, job, phase)}>
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {filteredContexts.length === 0 && (
          <Card variant="outlined" sx={{ p: 5, textAlign: 'center', mt: 2 }}>
            <ReceiptLongRoundedIcon color="disabled" sx={{ fontSize: 42 }} />
            <Typography fontWeight={750} sx={{ mt: 1 }}>No packages found</Typography>
            <Typography variant="body2" color="text.secondary">
              Create a Draw and choose its Job, phase-building, lots and draws.
            </Typography>
          </Card>
        )}
      </Box>
    </Box>
  )
}

export default function DrawAndInvoicePackages() {
  const navigate = useNavigate()
  const { builderId, jobId, phaseId, packageId } = useParams()
  const { jobs } = useJobs()
  const { builderDrawSchedules } = useBuilderDrawSchedules()
  const { drawInvoicePackages, createDrawInvoicePackage } = useDrawInvoicePackages()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const handleCreate = (input) => {
    const record = createDrawInvoicePackage(input)
    const job = jobs.find((candidate) => String(candidate.id) === String(record.jobId))
    setCreateDialogOpen(false)
    navigate(
      jobDrawInvoicePath(
        getJobBuilderId(job),
        record.jobId,
        record.phaseId,
        record.id,
      ),
    )
  }

  if (jobId == null) {
    return (
      <>
        <PackageCatalog
          jobs={jobs}
          schedules={builderDrawSchedules}
          packages={drawInvoicePackages}
          onCreate={() => setCreateDialogOpen(true)}
          onOpen={(record, job, phase) =>
            navigate(
              jobDrawInvoicePath(
                getJobBuilderId(job),
                job.id,
                phase.id,
                record.id,
              ),
            )
          }
        />
        {createDialogOpen && (
          <CreateDrawDialog
            jobs={jobs}
            schedules={builderDrawSchedules}
            packages={drawInvoicePackages}
            onClose={() => setCreateDialogOpen(false)}
            onCreate={handleCreate}
          />
        )}
      </>
    )
  }

  const focusedJob = jobs.find(
    (job) =>
      String(job.id) === String(jobId) && jobBelongsToBuilder(job, builderId),
  )

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
  const selectedPhase =
    phases.find((phase) => String(phase.id) === String(phaseId)) ?? phases[0]
  const focusedBuilderId = getJobBuilderId(focusedJob)
  const schedule = builderDrawSchedules.find(
    (item) => String(item.builderId) === String(focusedBuilderId),
  )
  const worksheet = buildDrawWorksheet(focusedJob, selectedPhase, schedule)
  const focusedPackage = drawInvoicePackages.find(
    (record) =>
      String(record.id) === String(packageId) &&
      String(record.jobId) === String(focusedJob.id) &&
      String(record.phaseId) === String(selectedPhase?.id),
  )
  const packageSummary = focusedPackage
    ? summarizeDrawPackage(focusedPackage, focusedJob, selectedPhase, schedule)
    : null

  const handlePhaseChange = (event) => {
    navigate(jobDrawInvoicePath(focusedBuilderId, focusedJob.id, event.target.value))
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
              {focusedPackage?.packageNumber ?? `Job #${focusedJob.code} Draw worksheet`}
            </Typography>
            {selectedPhase && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Job #{focusedJob.code} · {formatPhase(selectedPhase.name)} ·{' '}
                {formatBuilding(selectedPhase.building)}
                {focusedPackage?.invoiceNumber
                  ? ` · Invoice ${focusedPackage.invoiceNumber}`
                  : ''}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={1}>
            {focusedPackage ? (
              <PackageStatusChip status={focusedPackage.status} />
            ) : (
              <ReadinessChip worksheet={worksheet} />
            )}
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => setCreateDialogOpen(true)}
              disableElevation
            >
              Create Draw
            </Button>
          </Stack>
        </Stack>
      </Box>

      <JobModuleNavigation active="draw-invoice" builderId={focusedBuilderId} jobId={focusedJob.id} />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {phases.length === 0 ? (
          <Alert
            severity="info"
            action={
              <Button component={RouterLink} to={jobSequenceSheetPath(focusedBuilderId, focusedJob.id)} color="inherit">
                Open Sequence Sheet
              </Button>
            }
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
                    <Typography fontWeight={800}>Worksheet scope</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Review which lot/draw combinations are available or already packaged.
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
                        {formatPhase(phase.name)} · {formatBuilding(phase.building)} · {phase.lots?.length ?? 0} lots
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </CardContent>
            </Card>

            {packageSummary ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <MetricCard
                  icon={<ApartmentRoundedIcon />}
                  label="Lots in package"
                  value={packageSummary.lotCount}
                  detail={`${packageSummary.scopeCount} lot/draw scopes`}
                />
                <MetricCard
                  icon={<LayersRoundedIcon />}
                  label="Draws in package"
                  value={focusedPackage.drawIndexes.length}
                  detail={focusedPackage.drawIndexes.map((drawIndex) => `Draw ${drawIndex + 1}`).join(', ')}
                />
                <MetricCard
                  icon={<AttachMoneyRoundedIcon />}
                  label="Current Draw"
                  value={formatCurrency(packageSummary.currentDraw)}
                  detail={`Retention ${formatCurrency(packageSummary.retention)} · WRAP ${formatCurrency(packageSummary.wrapInsurance)}`}
                />
                <MetricCard
                  icon={<ReceiptLongRoundedIcon />}
                  label="Invoice Amount"
                  value={formatCurrency(packageSummary.invoiceAmount)}
                  detail={packageSummary.optionsTotal > 0
                    ? `${formatCurrency(packageSummary.optionsTotal)} options included`
                    : focusedPackage.invoiceNumber
                      ? `Invoice ${focusedPackage.invoiceNumber}`
                      : 'Invoice pending'}
                />
              </Stack>
            ) : (
              <Alert severity="info">
                This is the worksheet overview. Use Create Draw to select lots and
                one or more available draws for a new package.
              </Alert>
            )}

            {!worksheet.hasSchedule && (
              <Alert
                severity="warning"
                action={<Button component={RouterLink} to="/builder-draw-schedules" color="inherit">Configure schedule</Button>}
              >
                {focusedJob.builder} does not have a Builder Draw Schedule.
              </Alert>
            )}
            {(worksheet.missingPlanCount > 0 || worksheet.unpricedLotCount > 0) && (
              <Alert
                severity="warning"
                action={<Button component={RouterLink} to={jobPlanPricingPath(focusedBuilderId, focusedJob.id)} color="inherit">Open pricing</Button>}
              >
                Complete missing plan assignments and prices before creating a package.
              </Alert>
            )}

            {focusedPackage && (
              <Card variant="outlined">
                <CardContent>
                  <Typography fontWeight={800}>Package documents</Typography>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
                    {focusedPackage.documents.map((document) => (
                      <Chip
                        key={document.type}
                        color={document.status === 'COMPLETE' ? 'success' : 'default'}
                        variant={document.status === 'COMPLETE' ? 'filled' : 'outlined'}
                        icon={document.status === 'COMPLETE' ? <CheckCircleRoundedIcon /> : undefined}
                        label={`${document.label} · ${document.status === 'COMPLETE' ? 'Complete' : 'Pending'}`}
                      />
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}

            <DrawWorksheetTable
              job={focusedJob}
              phase={selectedPhase}
              worksheet={worksheet}
              packages={drawInvoicePackages}
              currentPackageId={focusedPackage?.id}
            />

            {focusedPackage && <PackageOptionsTable summary={packageSummary} />}
          </Stack>
        )}
      </Box>

      {createDialogOpen && (
        <CreateDrawDialog
          jobs={jobs}
          schedules={builderDrawSchedules}
          packages={drawInvoicePackages}
          initialJobId={focusedJob.id}
          initialPhaseId={selectedPhase?.id}
          onClose={() => setCreateDialogOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </Box>
  )
}
