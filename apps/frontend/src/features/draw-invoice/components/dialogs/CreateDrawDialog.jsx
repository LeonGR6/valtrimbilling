import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import {
  getJobBuilderId,
  jobPlanPricingPath,
} from '../../../jobs/utils/jobRoutes.js'
import {
  formatBuilding,
  formatPhase,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import {
  buildOptionChargeContext,
  buildUsedDrawSelections,
  drawSelectionKey,
  summarizeDrawPackage,
} from '../../utils/drawPackages.js'
import { buildDrawWorksheet } from '../../utils/drawWorksheet.js'
import {
  formatCurrency,
  readinessLabel,
} from '../../utils/drawInvoiceFormatters.js'
import DrawSelectionGrid from './DrawSelectionGrid.jsx'
import SelectableOptionsTable from './SelectableOptionsTable.jsx'

export default function CreateDrawDialog({
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
  const [excludedOptionKeys, setExcludedOptionKeys] = useState([])
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
  const selectedDrawIndexes = [...new Set(
    selectedSelections.map(({ drawIndex }) => drawIndex),
  )].sort((left, right) => left - right)

  const selectionIsUsed = (lotId, drawIndex) =>
    usedSelections.has(
      drawSelectionKey(job?.id, phase?.id, lotId, drawIndex),
    )

  const selectionIsSelected = (lotId, drawIndex) =>
    selectedSelectionKeys.has(`${phase?.id}:${lotId}:${drawIndex}`)

  const clearExcludedOptionsWithoutBillingDraw = (selections) => {
    const optionsBillingDrawIndex = schedule?.optionsBillingDrawIndex
    if (!selections.some(
      ({ drawIndex }) => optionsBillingDrawIndex != null
        && Number(drawIndex) >= Number(optionsBillingDrawIndex),
    )) {
      setExcludedOptionKeys([])
    }
  }

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
    setExcludedOptionKeys([])
  }

  const handlePhaseChange = (event) => {
    setSelectedPhaseId(event.target.value)
  }

  const toggleSelection = (lotId, drawIndex) => {
    if (selectionIsUsed(lotId, drawIndex)) return

    const key = `${phase.id}:${lotId}:${drawIndex}`
    const nextSelections = selectedSelections.some(
      (selection) => (
        `${selection.phaseId}:${selection.lotId}:${selection.drawIndex}` === key
      ),
    )
      ? selectedSelections.filter(
          (selection) => (
            `${selection.phaseId}:${selection.lotId}:${selection.drawIndex}` !== key
          ),
        )
      : [...selectedSelections, { phaseId: phase.id, lotId, drawIndex }]

    clearExcludedOptionsWithoutBillingDraw(nextSelections)
    setSelectedSelections(nextSelections)
  }

  const toggleSelectionGroup = (available) => {
    const availableKeys = new Set(
      available.map(
        ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`,
      ),
    )

    const allSelected = available.length > 0 && available.every(
      ({ phaseId, lotId, drawIndex }) => (
        selectedSelectionKeys.has(`${phaseId}:${lotId}:${drawIndex}`)
      ),
    )

    const currentKeys = new Set(selectedSelections.map(
      ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`,
    ))
    const nextSelections = allSelected
      ? selectedSelections.filter(
        (selection) => !availableKeys.has(
          `${selection.phaseId}:${selection.lotId}:${selection.drawIndex}`,
        ),
      )
      : [
          ...selectedSelections,
          ...available.filter(
            ({ phaseId, lotId, drawIndex }) => !currentKeys.has(
              `${phaseId}:${lotId}:${drawIndex}`,
            ),
          ),
        ]

    clearExcludedOptionsWithoutBillingDraw(nextSelections)
    setSelectedSelections(nextSelections)
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

  const optionChargeContext = buildOptionChargeContext(
    packages,
    job?.id,
    schedule?.optionsBillingDrawIndex ?? null,
  )
  const draftRecord = {
    lotIds: selectedSelections.map(({ lotId }) => lotId),
    drawIndexes: selectedDrawIndexes,
    optionsBillingDrawIndex: schedule?.optionsBillingDrawIndex ?? null,
    selections: selectedSelections,
    excludedOptionKeys,
    ...optionChargeContext,
  }
  const summary = summarizeDrawPackage(draftRecord, job, phases, schedule)

  const toggleOption = (option) => {
    setExcludedOptionKeys((current) => current.includes(option.id)
      ? current.filter((key) => key !== option.id)
      : [...current, option.id])
  }
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
        optionSelections: summary.selectedOptionRows.map((option) => ({
          lotId: option.lotId,
          optionId: option.optionId,
        })),
        optionsBillingDrawIndex: summary.optionsBillingDrawIndex,
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
          Create Draw Package
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          A Draw Package creates one persisted package, its immutable calculated lines,
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

          <DrawSelectionGrid
            job={job}
            phase={phase}
            worksheet={worksheet}
            usedSelections={usedSelections}
            selectedSelections={selectedSelections}
            selectionIsUsed={selectionIsUsed}
            selectionIsSelected={selectionIsSelected}
            toggleSelection={toggleSelection}
            toggleLotSelections={toggleLotSelections}
            toggleDrawSelections={toggleDrawSelections}
          />

          {summary.optionsAreDue && (
            <SelectableOptionsTable summary={summary} onToggle={toggleOption} />
          )}

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
                Options are available from Draw #{summary.optionsBillingDrawIndex + 1}.
                {' '}This package will charge them with Draw #{summary.optionChargeDrawIndex + 1}.
                {' '}This package will add {formatCurrency(summary.optionsTotal)} in options.
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
