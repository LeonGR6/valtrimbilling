import { useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import MoveToInboxRoundedIcon from '@mui/icons-material/MoveToInboxRounded'
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
  CancelDrawPackageDialog,
  EditDrawPackageDialog,
  TransferDrawPackageCellsDialog,
} from './DrawPackageCorrectionDialogs.jsx'
import {
  DRAW_PACKAGE_STATUSES,
  DRAW_PACKAGE_STATUS_LABELS,
  canCorrectDrawPackage,
} from '../services/drawInvoicePackageRecord.js'
import {
  buildUsedDrawSelections,
  drawSelectionKey,
  summarizeDrawPackage,
} from '../utils/drawPackages.js'
import { buildDrawWorksheet } from '../utils/drawWorksheet.js'
import {
  PACKAGE_CATALOG_TABS,
  canDeleteDraftPackage,
  filterPackageCatalogContexts,
  packageCatalogBuilderOptions,
  packageCatalogCommunityOptions,
  summarizePackageCatalogStatuses,
} from '../utils/packageCatalog.js'

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
  { key: 'status', width: 155 },
  { key: 'action', width: 140 },
]

const packageTableMinimumWidth = packageTableColumns.reduce(
  (total, column) => total + column.width,
  0,
)

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
    status === 'CANCELLED'
      ? 'default'
      : status === 'PAID_CLOSED'
        ? 'success'
        : status === 'AWAITING_PAYMENT'
          ? 'info'
          : status === 'DRAFT'
            ? 'warning'
            : 'primary'

  return (
    <Chip
      size="small"
      color={color}
      variant={status === 'DRAFT' ? 'outlined' : 'filled'}
      label={DRAW_PACKAGE_STATUS_LABELS[status] ?? status}
      sx={{ fontWeight: 750 }}
    />
  )
}

function PackageStatusControl({ status, disabled, onChange }) {
  return (
    <TextField
      select
      size="small"
      label="Package status"
      value={status}
      onChange={onChange}
      disabled={disabled}
      sx={{ minWidth: 190 }}
    >
      {DRAW_PACKAGE_STATUSES.map((packageStatus) => (
        <MenuItem key={packageStatus} value={packageStatus}>
          {DRAW_PACKAGE_STATUS_LABELS[packageStatus]}
        </MenuItem>
      ))}
    </TextField>
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
  const jobPhases = job?.sequenceSheet?.phases ?? []
  const phaseIds = new Set(
    (record.phaseIds?.length ? record.phaseIds : [record.phaseId])
      .filter((value) => value != null)
      .map(String),
  )
  const phases = jobPhases.filter((candidate) => phaseIds.has(String(candidate.id)))
  const phase = phases[0]
  const schedule = schedules.find(
    (candidate) =>
      String(candidate.builderId) === String(getJobBuilderId(job)),
  )

  if (!job || !phase) return null
  return {
    record,
    job,
    phase,
    phases,
    schedule,
    summary: summarizeDrawPackage(record, job, phases, schedule),
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
  const [selectedSelections, setSelectedSelections] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

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
  const selectedSelectionKeys = new Set(
    selectedSelections.map(
      ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`,
    ),
  )
  const selectedLotKeys = [...new Set(
    selectedSelections.map(({ phaseId, lotId }) => `${phaseId}:${lotId}`),
  )]
  const selectedDrawIndexes = [...new Set(
    selectedSelections.map(({ drawIndex }) => drawIndex),
  )].sort((left, right) => left - right)

  const selectionIsUsed = (lotId, drawIndex) =>
    usedSelections.has(
      drawSelectionKey(job?.id, phase?.id, lotId, drawIndex),
    )

  const selectionIsSelected = (lotId, drawIndex) =>
    selectedSelectionKeys.has(`${phase?.id}:${lotId}:${drawIndex}`)

  const handleJobChange = (event) => {
    const nextJobId = event.target.value
    const nextJob = jobs.find((candidate) => String(candidate.id) === nextJobId)
    setSelectedJobId(nextJobId)
    setSelectedPhaseId(
      nextJob?.sequenceSheet?.phases?.[0]?.id == null
        ? ''
        : String(nextJob.sequenceSheet.phases[0].id),
    )
    setSelectedSelections([])
  }

  const handlePhaseChange = (event) => {
    setSelectedPhaseId(event.target.value)
  }

  const toggleSelection = (lotId, drawIndex) => {
    if (selectionIsUsed(lotId, drawIndex)) return

    const key = `${phase.id}:${lotId}:${drawIndex}`
    setSelectedSelections((current) =>
      current.some(
        (selection) => (
          `${selection.phaseId}:${selection.lotId}:${selection.drawIndex}` === key
        ),
      )
        ? current.filter(
            (selection) => (
              `${selection.phaseId}:${selection.lotId}:${selection.drawIndex}` !== key
            ),
          )
        : [...current, { phaseId: phase.id, lotId, drawIndex }],
    )
  }

  const toggleSelectionGroup = (available) => {
    const availableKeys = new Set(
      available.map(
        ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`,
      ),
    )

    setSelectedSelections((current) => {
      const currentKeys = new Set(
        current.map(
          ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`,
        ),
      )
      const allSelected = available.length > 0 && available.every(
        ({ phaseId, lotId, drawIndex }) => (
          currentKeys.has(`${phaseId}:${lotId}:${drawIndex}`)
        ),
      )

      return allSelected
        ? current.filter(
          (selection) => !availableKeys.has(
            `${selection.phaseId}:${selection.lotId}:${selection.drawIndex}`,
          ),
        )
        : [
            ...current,
            ...available.filter(
              ({ phaseId, lotId, drawIndex }) => !currentKeys.has(
                `${phaseId}:${lotId}:${drawIndex}`,
              ),
            ),
          ]
    })
  }

  const toggleLotSelections = (lotId) => {
    const available = worksheet.draws
      .map((_, drawIndex) => ({ phaseId: phase.id, lotId, drawIndex }))
      .filter(({ drawIndex }) => !selectionIsUsed(lotId, drawIndex))

    toggleSelectionGroup(available)
  }

  const toggleDrawSelections = (drawIndex) => {
    const available = worksheet.rows
      .map((row) => ({ phaseId: phase.id, lotId: row.id, drawIndex }))
      .filter(({ lotId }) => !selectionIsUsed(lotId, drawIndex))

    toggleSelectionGroup(available)
  }

  const draftRecord = {
    lotIds: selectedSelections.map(({ lotId }) => lotId),
    drawIndexes: selectedDrawIndexes,
    optionsBillingDrawIndex: schedule?.optionsBillingDrawIndex ?? null,
    selections: selectedSelections,
  }
  const summary = summarizeDrawPackage(draftRecord, job, phases, schedule)
  const selectedPhaseIds = new Set(
    selectedSelections.map(({ phaseId }) => String(phaseId)),
  )
  const selectedPhasesAreReady = phases
    .filter((candidate) => selectedPhaseIds.has(String(candidate.id)))
    .every((candidate) => buildDrawWorksheet(job, candidate, schedule).isReady)
  const canCreate =
    selectedPhasesAreReady &&
    selectedSelections.length > 0 &&
    summary.unpricedOptionCount === 0

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onCreate({
        jobId: job.id,
        selections: selectedSelections,
        schedule,
      })
    } catch (error) {
      setSubmitError(error.message)
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={800}>
          Create Draw
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          A Draw creates one persisted package, its immutable calculated lines,
          and an invoice total snapshot.
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
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1 }}
            >
              <Box>
                <Typography fontWeight={800}>Select Lot / Draw cells</Typography>
                <Typography variant="body2" color="text.secondary">
                  Choose each cell independently. Yellow cells already belong to
                  another Package. Change Phase to add more cells from this same Job;
                  selections from earlier Phases remain included.
                </Typography>
              </Box>
              <Chip
                size="small"
                color={selectedSelections.length > 0 ? 'primary' : 'default'}
                variant={selectedSelections.length > 0 ? 'filled' : 'outlined'}
                label={`${selectedSelections.length} ${selectedSelections.length === 1 ? 'cell' : 'cells'} selected`}
              />
            </Stack>
            <Card variant="outlined" sx={{ overflow: 'hidden' }}>
              <TableContainer sx={{ maxHeight: 460 }}>
                <Table
                  size="small"
                  stickyHeader
                  aria-label="Lot and Draw cells available for this package"
                  sx={{
                    minWidth: 300 + worksheet.draws.length * 155,
                    '& .MuiTableCell-root': { px: 1.2, py: 1 },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell rowSpan={2} sx={{ width: 95, fontWeight: 800 }}>
                        Lot
                      </TableCell>
                      <TableCell rowSpan={2} sx={{ width: 90, fontWeight: 800 }}>
                        Plan
                      </TableCell>
                      <TableCell
                        rowSpan={2}
                        align="right"
                        sx={{ width: 115, fontWeight: 800 }}
                      >
                        {worksheet.separateHardwarePrice ? 'Draw base / lot' : 'Price per lot'}
                      </TableCell>
                      {worksheet.draws.map((draw, drawIndex) => (
                        <TableCell
                          key={`select-draw-heading-${drawIndex}`}
                          align="center"
                          sx={{
                            minWidth: 155,
                            borderLeft: 1,
                            borderColor: 'divider',
                            bgcolor: 'primary.light',
                          }}
                        >
                          <Typography color="primary.main" fontWeight={850}>
                            Draw #{drawIndex + 1}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="primary.main"
                            fontWeight={750}
                            component="div"
                          >
                            {formatPercentage(draw.percentage)}%
                            {draw.name?.trim() ? ` · ${draw.name.trim()}` : ''}
                          </Typography>
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      {worksheet.draws.map((_, drawIndex) => {
                        const availableRows = worksheet.rows.filter(
                          (row) => !selectionIsUsed(row.id, drawIndex),
                        )
                        const selectedCount = availableRows.filter(
                          (row) => selectionIsSelected(row.id, drawIndex),
                        ).length
                        const allSelected = availableRows.length > 0
                          && selectedCount === availableRows.length

                        return (
                          <TableCell
                            key={`select-draw-${drawIndex}`}
                            align="center"
                            sx={{ borderLeft: 1, borderColor: 'divider' }}
                          >
                            <Stack
                              direction="row"
                              spacing={0.25}
                              sx={{ alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Checkbox
                                size="small"
                                checked={allSelected}
                                indeterminate={selectedCount > 0 && !allSelected}
                                disabled={availableRows.length === 0}
                                onChange={() => toggleDrawSelections(drawIndex)}
                                inputProps={{
                                  'aria-label': `Select available cells for Draw ${drawIndex + 1}`,
                                }}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {selectedCount}/{availableRows.length}
                              </Typography>
                            </Stack>
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {worksheet.rows.map((row) => {
                      const availableDrawIndexes = worksheet.draws
                        .map((_, drawIndex) => drawIndex)
                        .filter((drawIndex) => !selectionIsUsed(row.id, drawIndex))
                      const selectedCount = availableDrawIndexes.filter(
                        (drawIndex) => selectionIsSelected(row.id, drawIndex),
                      ).length
                      const allSelected = availableDrawIndexes.length > 0
                        && selectedCount === availableDrawIndexes.length

                      return (
                        <TableRow key={row.id} hover>
                          <TableCell>
                            <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
                              <Checkbox
                                size="small"
                                checked={allSelected}
                                indeterminate={selectedCount > 0 && !allSelected}
                                disabled={availableDrawIndexes.length === 0}
                                onChange={() => toggleLotSelections(row.id)}
                                inputProps={{
                                  'aria-label': `Select available Draws for lot ${row.lotNumber}`,
                                }}
                              />
                              <Typography color="error.main" fontWeight={850}>
                                {row.lotNumber}
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography fontWeight={750}>{row.planCode ?? '—'}</Typography>
                            {(row.selectedOptions?.length ?? 0) > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                {row.selectedOptions.length}{' '}
                                {row.selectedOptions.length === 1 ? 'option' : 'options'}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Typography fontWeight={750}>
                              {formatCurrency(row.drawBasePrice)}
                            </Typography>
                          </TableCell>
                          {worksheet.draws.map((_, drawIndex) => {
                            const key = drawSelectionKey(
                              job?.id,
                              phase?.id,
                              row.id,
                              drawIndex,
                            )
                            const owner = usedSelections.get(key)
                            const selected = selectionIsSelected(row.id, drawIndex)

                            return (
                              <TableCell
                                key={key}
                                align="center"
                                onClick={() => !owner && toggleSelection(row.id, drawIndex)}
                                sx={{
                                  borderLeft: 1,
                                  borderColor: selected ? 'primary.main' : 'divider',
                                  bgcolor: owner
                                    ? 'warning.light'
                                    : selected
                                      ? 'primary.light'
                                      : undefined,
                                  cursor: owner ? 'default' : 'pointer',
                                }}
                              >
                                {owner ? (
                                  <Box>
                                    <Stack
                                      direction="row"
                                      spacing={0.5}
                                      sx={{ alignItems: 'center', justifyContent: 'center' }}
                                    >
                                      <LockRoundedIcon sx={{ fontSize: 14 }} />
                                      <Typography variant="caption" fontWeight={850}>
                                        {owner.packageNumber}
                                      </Typography>
                                    </Stack>
                                    <Typography variant="caption" component="div">
                                      {formatCurrency(row.drawAmounts[drawIndex])}
                                    </Typography>
                                  </Box>
                                ) : (
                                  <Stack
                                    direction="row"
                                    spacing={0.25}
                                    sx={{ alignItems: 'center', justifyContent: 'center' }}
                                  >
                                    <Checkbox
                                      size="small"
                                      checked={selected}
                                      onClick={(event) => event.stopPropagation()}
                                      onChange={() => toggleSelection(row.id, drawIndex)}
                                      inputProps={{
                                        'aria-label': `Select lot ${row.lotNumber}, Draw ${drawIndex + 1}`,
                                      }}
                                    />
                                    <Typography variant="body2" fontWeight={850}>
                                      {formatCurrency(row.drawAmounts[drawIndex])}
                                    </Typography>
                                  </Stack>
                                )}
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                  {worksheet.rows.length > 0 && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Typography fontWeight={850}>
                            {selectedLotKeys.length}{' '}
                            {selectedLotKeys.length === 1 ? 'lot' : 'lots'} ·{' '}
                            {selectedSelections.length}{' '}
                            {selectedSelections.length === 1 ? 'cell' : 'cells'}
                          </Typography>
                        </TableCell>
                        {worksheet.draws.map((_, drawIndex) => (
                          <TableCell
                            key={`selected-total-${drawIndex}`}
                            align="center"
                            sx={{ borderLeft: 1, borderColor: 'divider' }}
                          >
                            <Typography variant="caption" color="text.secondary">
                              {selectedSelections.filter(
                                (selection) => (
                                  String(selection.phaseId) === String(phase.id)
                                  && selection.drawIndex === drawIndex
                                ),
                              ).length}{' '}
                              selected
                            </Typography>
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </TableContainer>
            </Card>
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
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {summary.phaseSummaries.map((phaseSummary) => (
                    <Box key={phaseSummary.phaseId}>
                      <Typography variant="body2" fontWeight={800}>
                        {formatPhase(phaseSummary.phaseCode)} ·{' '}
                        {formatBuilding(phaseSummary.building)}
                      </Typography>
                      {phaseSummary.draws.map((draw) => (
                        <Typography
                          key={`${phaseSummary.phaseId}:${draw.drawIndex}`}
                          variant="caption"
                          color="text.secondary"
                          component="div"
                        >
                          Lots {draw.lotRange} · Draw #{draw.drawIndex + 1}
                        </Typography>
                      ))}
                    </Box>
                  ))}
                </Stack>
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

          {submitError && <Alert severity="error">{submitError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          disabled={!canCreate || submitting}
          disableElevation
          onClick={handleSubmit}
        >
          {submitting ? 'Creating…' : 'Create package'}
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
                <TableCell>Phase</TableCell>
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
                      {formatPhase(option.phaseCode)} / {formatBuilding(option.building)}
                    </TableCell>
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
                  <TableCell colSpan={6}>
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

const packageSummaryCards = [
  { status: 'DRAFT', icon: <ReceiptLongRoundedIcon />, color: 'primary.main' },
  { status: 'READY_TO_SUBMIT', icon: <CheckCircleRoundedIcon />, color: 'success.main' },
  { status: 'AWAITING_PAYMENT', icon: <AttachMoneyRoundedIcon />, color: 'info.main' },
  { status: 'PAID_CLOSED', icon: <LockRoundedIcon />, color: 'success.main' },
]

function PackageSummaryCard({ status, icon, color, count, total, selected, onSelect }) {
  return (
    <Card
      variant="outlined"
      sx={{ borderColor: selected ? color : 'divider', minWidth: 0 }}
    >
      <CardActionArea onClick={onSelect} aria-label={`Show ${DRAW_PACKAGE_STATUS_LABELS[status]} Packages`}>
        <CardContent sx={{ p: '18px !important' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{
              width: 42, height: 42, flexShrink: 0, borderRadius: 1.5,
              display: 'grid', placeItems: 'center',
              bgcolor: 'action.hover', color,
            }}>
              {icon}
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={750} color="text.secondary">
                {DRAW_PACKAGE_STATUS_LABELS[status]}
              </Typography>
              <Typography variant="h5" fontWeight={850} sx={{ lineHeight: 1.3 }}>
                {count}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatCurrency(total)} invoice total
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

function PackageActionMenu({ context, canManage, onOpen, onAction }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const { record } = context
  const editable = canManage && canCorrectDrawPackage(record)
  const deletable = canManage && canDeleteDraftPackage(record)
  const close = () => setAnchorEl(null)
  const choose = (action) => {
    close()
    if (action === 'open') onOpen(context)
    else onAction(action, context)
  }

  return (
    <>
      <ButtonGroup size="small" variant="contained" disableElevation>
        <Button onClick={() => onOpen(context)}>Open</Button>
        <Button
          aria-label={`More actions for ${record.packageNumber}`}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchorEl)}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ minWidth: 32, px: 0.5 }}
        >
          <ArrowDropDownRoundedIcon />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={close}>
        <MenuItem onClick={() => choose('open')}>Open Package</MenuItem>
        {editable && (
          <MenuItem onClick={() => choose('edit')}>
            <ListItemIcon><EditRoundedIcon fontSize="small" /></ListItemIcon>
            Edit Package
          </MenuItem>
        )}
        {editable && (
          <MenuItem onClick={() => choose('transfer')}>
            <ListItemIcon><MoveToInboxRoundedIcon fontSize="small" /></ListItemIcon>
            Move cells here
          </MenuItem>
        )}
        {deletable && (
          <MenuItem onClick={() => choose('delete')} sx={{ color: 'error.main' }}>
            <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" color="error" /></ListItemIcon>
            Delete draft
          </MenuItem>
        )}
      </Menu>
    </>
  )
}

function PackageCatalog({
  jobs,
  schedules,
  packages,
  canManage,
  error,
  onRetry,
  onOpen,
  onCreate,
  onEdit,
  onTransfer,
  onDelete,
}) {
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState('ALL')
  const [builderFilter, setBuilderFilter] = useState('ALL')
  const [communityFilter, setCommunityFilter] = useState('ALL')
  const [catalogAction, setCatalogAction] = useState(null)
  const contexts = useMemo(
    () => packages.map((record) => getPackageContext(record, jobs, schedules)).filter(Boolean),
    [jobs, packages, schedules],
  )
  const activeContexts = useMemo(
    () => filterPackageCatalogContexts(contexts),
    [contexts],
  )
  const builderOptions = useMemo(
    () => packageCatalogBuilderOptions(contexts),
    [contexts],
  )
  const communityOptions = useMemo(
    () => packageCatalogCommunityOptions(contexts, builderFilter),
    [contexts, builderFilter],
  )
  const scopedContexts = useMemo(
    () => filterPackageCatalogContexts(activeContexts, {
      search, builderId: builderFilter, community: communityFilter,
    }),
    [activeContexts, search, builderFilter, communityFilter],
  )
  const statusSummary = useMemo(
    () => summarizePackageCatalogStatuses(scopedContexts),
    [scopedContexts],
  )
  const filteredContexts = useMemo(
    () => filterPackageCatalogContexts(scopedContexts, { status: statusTab }),
    [scopedContexts, statusTab],
  )
  const selectedContext = contexts.find(
    ({ record }) => String(record.id) === String(catalogAction?.packageId),
  )
  const clearFilters = () => {
    setSearch('')
    setBuilderFilter('ALL')
    setCommunityFilter('ALL')
    setStatusTab('ALL')
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
              Review active Packages by status. Draft corrections retain an
              audit history; deleted drafts leave this active list.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={onCreate}
            disabled={!canManage}
            disableElevation
          >
            Create Draw
          </Button>
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {error && (
          <Alert
            severity="error"
            action={<Button color="inherit" onClick={onRetry}>Retry</Button>}
            sx={{ mb: 2 }}
          >
            {error}
          </Alert>
        )}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 1.5,
          mb: 2.5,
        }}>
          {packageSummaryCards.map(({ status, icon, color }) => (
            <PackageSummaryCard
              key={status}
              status={status}
              icon={icon}
              color={color}
              count={statusSummary[status].count}
              total={statusSummary[status].total}
              selected={statusTab === status}
              onSelect={() => setStatusTab(status)}
            />
          ))}
        </Box>

        <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <Tabs
            value={statusTab}
            onChange={(_, value) => setStatusTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            aria-label="Filter Packages by status"
            sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}
          >
            {PACKAGE_CATALOG_TABS.map(({ value, label }) => (
              <Tab
                key={value}
                value={value}
                label={`${label} (${value === 'ALL'
                  ? scopedContexts.length
                  : statusSummary[value].count})`}
              />
            ))}
          </Tabs>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ p: 2, alignItems: { md: 'center' } }}
          >
            <TextField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Package, Invoice, Job or Phase"
              size="small"
              aria-label="Search Packages"
              sx={{ flex: 2, minWidth: { md: 230 } }}
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
              value={builderFilter}
              onChange={(event) => {
                setBuilderFilter(event.target.value)
                setCommunityFilter('ALL')
              }}
              sx={{ flex: 1, minWidth: { md: 170 } }}
            >
              <MenuItem value="ALL">All builders</MenuItem>
              {builderOptions.map(({ id, name }) => (
                <MenuItem key={id} value={id}>{name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Community"
              value={communityFilter}
              onChange={(event) => setCommunityFilter(event.target.value)}
              sx={{ flex: 1, minWidth: { md: 170 } }}
            >
              <MenuItem value="ALL">All communities</MenuItem>
              {communityOptions.map((community) => (
                <MenuItem key={community} value={community}>{community}</MenuItem>
              ))}
            </TextField>
            <Button color="inherit" onClick={clearFilters} sx={{ flexShrink: 0 }}>
              Clear filters
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pb: 1.5 }}>
            Cards summarize all active statuses in the current Builder, Community and search scope.
          </Typography>
        </Box>

        <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', mt: 1.5 }}>
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
                  <TableCell>Status</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredContexts.map(({ record, job, phase, phases, summary }) => (
                    <TableRow
                      key={record.id}
                      hover
                      onClick={() => onOpen(record, job, phase)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Button
                          color="inherit"
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpen(record, job, phase)
                          }}
                          sx={{
                            p: 0,
                            minWidth: 0,
                            fontWeight: 800,
                            fontSize: '1rem',
                            textTransform: 'none',
                            justifyContent: 'flex-start',
                          }}
                        >
                          {record.packageNumber}
                        </Button>
                        <Typography variant="body2" color="text.secondary">
                          Job #{job.code} · {summary.phaseCount === 1
                            ? `${formatPhase(phase.name)} / ${formatBuilding(phase.building)}`
                            : `${summary.phaseCount} Phases`}
                        </Typography>
                        {summary.phaseSummaries.map((scope) => (
                          <Typography
                            key={scope.phaseId}
                            variant="caption"
                            color="text.secondary"
                            component="div"
                          >
                            {formatPhase(scope.phaseCode)}: {scope.draws.map(
                              (draw) => `Lots ${draw.lotRange} / Draw ${draw.drawIndex + 1}`,
                            ).join(' · ')}
                          </Typography>
                        ))}
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
                      <TableCell><PackageStatusChip status={record.status} /></TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <PackageActionMenu
                          context={{ record, job, phase, phases, summary }}
                          canManage={canManage}
                          onOpen={(selected) => onOpen(
                            selected.record, selected.job, selected.phase,
                          )}
                          onAction={(action, selected) => setCatalogAction({
                            action, packageId: selected.record.id,
                          })}
                        />
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {filteredContexts.length === 0 && (
          <Card variant="outlined" sx={{ p: 5, textAlign: 'center', mt: 2 }}>
            <ReceiptLongRoundedIcon color="disabled" sx={{ fontSize: 42 }} />
            <Typography fontWeight={750} sx={{ mt: 1 }}>
              {activeContexts.length === 0 ? 'No active Packages yet' : 'No Packages match these filters'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Cancelled Packages are kept in audit history, not in this table.
            </Typography>
            {activeContexts.length > 0 && (
              <Button onClick={clearFilters} sx={{ mt: 1 }}>Clear filters</Button>
            )}
          </Card>
        )}
      </Box>
      {catalogAction?.action === 'edit' && selectedContext && (
        <EditDrawPackageDialog
          record={selectedContext.record}
          job={selectedContext.job}
          phase={selectedContext.phase}
          phases={selectedContext.phases}
          schedule={selectedContext.schedule}
          packages={packages}
          onClose={() => setCatalogAction(null)}
          onSave={onEdit}
        />
      )}
      {catalogAction?.action === 'transfer' && selectedContext && (
        <TransferDrawPackageCellsDialog
          target={selectedContext.record}
          packages={packages}
          onClose={() => setCatalogAction(null)}
          onTransfer={onTransfer}
        />
      )}
      {catalogAction?.action === 'delete' && selectedContext && (
        <CancelDrawPackageDialog
          record={selectedContext.record}
          onClose={() => setCatalogAction(null)}
          onCancel={onDelete}
        />
      )}
    </Box>
  )
}

export default function DrawAndInvoicePackages() {
  const navigate = useNavigate()
  const { builderId, jobId, phaseId, packageId } = useParams()
  const {
    jobs,
    loading: jobsLoading,
    error: jobsError,
    refreshJobs,
  } = useJobs()
  const { builderDrawSchedules } = useBuilderDrawSchedules()
  const {
    drawInvoicePackages,
    loading: packagesLoading,
    error: packagesError,
    saving,
    canManageDrawInvoicePackages,
    refreshDrawInvoicePackages,
    createDrawInvoicePackage,
    updateDrawInvoicePackageStatus,
    editDrawInvoicePackage,
    transferDrawPackageCells,
    cancelDrawInvoicePackage,
  } = useDrawInvoicePackages()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [correctionDialog, setCorrectionDialog] = useState(null)

  const handleCreate = async (input) => {
    const record = await createDrawInvoicePackage(input)
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

  const handleRetry = () => {
    Promise.all([
      refreshJobs(),
      refreshDrawInvoicePackages(),
    ]).catch(() => {})
  }

  const loading = jobsLoading || packagesLoading
  const error = jobsError || packagesError

  if (loading && (jobs.length === 0 || drawInvoicePackages.length === 0)) {
    return (
      <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
        <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
          <CircularProgress size={32} />
          <Typography color="text.secondary">Loading Draw & Invoice Packages…</Typography>
        </Stack>
      </Box>
    )
  }

  if (jobId == null) {
    return (
      <>
        <PackageCatalog
          jobs={jobs}
          schedules={builderDrawSchedules}
          packages={drawInvoicePackages}
          canManage={canManageDrawInvoicePackages}
          error={error}
          onRetry={handleRetry}
          onCreate={() => setCreateDialogOpen(true)}
          onEdit={editDrawInvoicePackage}
          onTransfer={transferDrawPackageCells}
          onDelete={cancelDrawInvoicePackage}
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
      String(record.jobId) === String(focusedJob.id),
  )
  const focusedPackagePhaseIds = new Set(
    (focusedPackage?.phaseIds?.length
      ? focusedPackage.phaseIds
      : [focusedPackage?.phaseId])
      .filter((value) => value != null)
      .map(String),
  )
  const focusedPackagePhases = phases.filter(
    (phase) => focusedPackagePhaseIds.has(String(phase.id)),
  )
  const packageSummary = focusedPackage
    ? summarizeDrawPackage(
        focusedPackage,
        focusedJob,
        focusedPackagePhases,
        schedule,
      )
    : null
  const canCorrectFocusedPackage = canManageDrawInvoicePackages
    && canCorrectDrawPackage(focusedPackage)
  const canDeleteFocusedPackage = canManageDrawInvoicePackages
    && canDeleteDraftPackage(focusedPackage)

  const handlePhaseChange = (event) => {
    navigate(jobDrawInvoicePath(focusedBuilderId, focusedJob.id, event.target.value))
  }

  const handlePackageStatusChange = (event) => {
    updateDrawInvoicePackageStatus(focusedPackage.id, event.target.value)
      .catch(() => {})
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
                {focusedPackage && packageSummary?.phaseCount > 1
                  ? ` · ${packageSummary.phaseCount} Phases in Package`
                  : ''}
                {focusedPackage?.invoiceNumber
                  ? ` · Invoice ${focusedPackage.invoiceNumber}`
                  : ''}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {focusedPackage ? (
              canManageDrawInvoicePackages && focusedPackage.status !== 'CANCELLED' ? (
                <PackageStatusControl
                  status={focusedPackage.status}
                  disabled={saving}
                  onChange={handlePackageStatusChange}
                />
              ) : (
                <PackageStatusChip status={focusedPackage.status} />
              )
            ) : (
              <ReadinessChip worksheet={worksheet} />
            )}
            {canCorrectFocusedPackage && (
              <>
                <Button
                  variant="outlined"
                  startIcon={<EditRoundedIcon />}
                  onClick={() => setCorrectionDialog('edit')}
                  disabled={saving}
                >
                  Edit Package
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<MoveToInboxRoundedIcon />}
                  onClick={() => setCorrectionDialog('transfer')}
                  disabled={saving}
                >
                  Move cells here
                </Button>
              </>
            )}
            {canDeleteFocusedPackage && (
              <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteOutlineRoundedIcon />}
                onClick={() => setCorrectionDialog('delete')}
                disabled={saving}
              >
                Delete draft
              </Button>
            )}
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => setCreateDialogOpen(true)}
              disabled={!canManageDrawInvoicePackages || saving}
              disableElevation
            >
              Create Draw
            </Button>
          </Stack>
        </Stack>
      </Box>

      <JobModuleNavigation active="draw-invoice" builderId={focusedBuilderId} jobId={focusedJob.id} />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {error && (
          <Alert
            severity="error"
            action={<Button color="inherit" onClick={handleRetry}>Retry</Button>}
            sx={{ mb: 2.5 }}
          >
            {error}
          </Alert>
        )}
        {focusedPackage?.status === 'CANCELLED' && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            This Package was cancelled on {formatDate(focusedPackage.cancelledAt?.slice(0, 10))}.
            Its Lot / Draw cells were released; the Package number remains for history.
            {focusedPackage.cancellationReason && ` Reason: ${focusedPackage.cancellationReason}`}
          </Alert>
        )}
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

            <DrawWorksheetTable
              job={focusedJob}
              phase={selectedPhase}
              worksheet={worksheet}
              packages={drawInvoicePackages}
              currentPackageId={focusedPackage?.id}
            />

            {focusedPackage && <PackageOptionsTable summary={packageSummary} />}
            {focusedPackage?.corrections?.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography fontWeight={800} sx={{ mb: 1 }}>Correction history</Typography>
                  <Stack spacing={1}>
                    {focusedPackage.corrections.map((correction) => (
                      <Typography key={correction.id} variant="body2" color="text.secondary">
                        {new Date(correction.changed_at).toLocaleString('en-US')} ·{' '}
                        {correction.action === 'TRANSFER'
                          ? String(correction.package_id) === String(focusedPackage.id)
                            ? 'Cells moved here'
                            : 'Cells moved out'
                          : correction.action.toLowerCase()} ·{' '}
                        {correction.reason}
                        {correction.action === 'TRANSFER' && ` · Other Package ID ${
                          String(correction.package_id) === String(focusedPackage.id)
                            ? correction.other_package_id
                            : correction.package_id
                        }`}
                      </Typography>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}
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
      {correctionDialog === 'edit' && focusedPackage && (
        <EditDrawPackageDialog
          record={focusedPackage}
          job={focusedJob}
          phase={selectedPhase}
          phases={focusedPackagePhases}
          schedule={schedule}
          packages={drawInvoicePackages}
          onClose={() => setCorrectionDialog(null)}
          onSave={editDrawInvoicePackage}
        />
      )}
      {correctionDialog === 'transfer' && focusedPackage && (
        <TransferDrawPackageCellsDialog
          target={focusedPackage}
          packages={drawInvoicePackages}
          onClose={() => setCorrectionDialog(null)}
          onTransfer={transferDrawPackageCells}
        />
      )}
      {correctionDialog === 'delete' && focusedPackage && (
        <CancelDrawPackageDialog
          record={focusedPackage}
          onClose={() => setCorrectionDialog(null)}
          onCancel={cancelDrawInvoicePackage}
        />
      )}
    </Box>
  )
}
