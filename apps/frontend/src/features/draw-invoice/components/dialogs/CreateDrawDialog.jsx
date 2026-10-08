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
  buildBilledHardwareCharges,
  buildBilledUtilityCharges,
  buildOptionChargeContext,
  buildUsedDrawSelections,
  drawSelectionKey,
  hardwareChargeKey,
  hardwareSelectionKey,
  summarizeDrawPackage,
  utilityChargeKey,
} from '../../utils/drawPackages.js'
import {
  buildDrawWorksheet,
  getHardwareBillingMode,
  getUtilityBillingMode,
  getUtilityEventPercentage,
} from '../../utils/drawWorksheet.js'
import {
  formatCurrency,
  formatLongDate,
  readinessLabel,
} from '../../utils/drawInvoiceFormatters.js'
import {
  buildAvailableSeparateHardwareSelections,
  buildCalendarDrawSuggestion,
  buildDrawCalendarHeadings,
  calendarSelectionKey,
  localDateKey,
} from '../../utils/calendarDrawSuggestions.js'
import DrawSelectionGrid from './DrawSelectionGrid.jsx'
import CreatePackageHardwareTable from './CreatePackageHardwareTable.jsx'
import CreatePackageUtilityTable from './CreatePackageUtilityTable.jsx'
import SelectableOptionsTable from './SelectableOptionsTable.jsx'

export default function CreateDrawDialog({
  jobs = [],
  schedules = [],
  jobBillingSetupVersions = [],
  packages = [],
  productionActivities = [],
  productionActivitiesLoading,
  productionActivitiesError,
  initialJobId,
  initialPhaseId,
  onClose,
  onCreate,
}) {
  // Nothing is preselected when the dialog opens from "Create Package": the
  // user picks the Job and the Phase / Building. A Package Suggestion opens it
  // with both already chosen.
  const initialJob = initialJobId == null
    ? null
    : jobs.find((candidate) => String(candidate.id) === String(initialJobId))
  const initialPhase = initialJob?.sequenceSheet?.phases?.find(
    (phase) => String(phase.id) === String(initialPhaseId),
  )
  const [selectedJobId, setSelectedJobId] = useState(
    initialJob == null ? '' : String(initialJob.id),
  )
  const [selectedPhaseId, setSelectedPhaseId] = useState(
    initialPhase == null ? '' : String(initialPhase.id),
  )
  const [selectionOverrides, setSelectedSelections] = useState(null)
  const [hardwareSelectionKeys, setHardwareSelectionKeys] = useState([])
  const [splitHardwareSelectionKeys, setSplitHardwareSelectionKeys] = useState(null)
  const [fullUtilityRowIds, setFullUtilityRowIds] = useState([])
  const [excludedUtilityChargeKeys, setExcludedUtilityChargeKeys] = useState([])
  const [excludedOptionKeys, setExcludedOptionKeys] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [asOfDate] = useState(() => localDateKey())

  const job = jobs.find((candidate) => String(candidate.id) === selectedJobId)
  const phases = job?.sequenceSheet?.phases ?? []
  const phase = phases.find(
    (candidate) => String(candidate.id) === selectedPhaseId,
  )
  const hasScope = Boolean(job && phase)
  const schedule = jobBillingSetupVersions.find(
    (candidate) => String(candidate.id) === String(job?.billingSetupVersionId),
  ) ?? schedules.find(
    (candidate) => String(candidate.builderId) === String(getJobBuilderId(job)),
  )
  const worksheet = buildDrawWorksheet(job, phase, schedule)
  const lotRows = worksheet.rows.filter((row) => !row.isUtilityBuilding)
  const utilityRows = worksheet.rows.filter((row) => row.isUtilityBuilding)
  const lotRowIds = new Set(lotRows.map((row) => String(row.id)))
  const lotWorksheet = { ...worksheet, rows: lotRows }
  const utilityWorksheet = { ...worksheet, rows: utilityRows }
  const usedSelections = useMemo(
    () => buildUsedDrawSelections(packages),
    [packages],
  )
  const billedHardwareCharges = buildBilledHardwareCharges(packages, job?.id)
  const billedUtilityCharges = buildBilledUtilityCharges(packages, job?.id)
  const calendarSuggestion = buildCalendarDrawSuggestion({
    activities: productionActivities,
    job,
    schedule,
    packages,
    asOfDate,
  })
  const drawCalendarHeadings = buildDrawCalendarHeadings({
    activities: productionActivities,
    job,
    phase,
    schedule,
  })
  const selectedSelections = selectionOverrides
    ?? calendarSuggestion.suggestedSelections
  const lotSelectedSelections = selectedSelections.filter(
    (selection) => lotRowIds.has(String(selection.lotId)),
  )
  const calendarReadySelectionKeys = new Set(
    calendarSuggestion.eligibleSelections.map(
      ({ phaseId, lotId, drawIndex }) =>
        calendarSelectionKey(phaseId, lotId, drawIndex),
    ),
  )
  const suggestedSelectionKeys = new Set(
    calendarSuggestion.suggestedSelections.map(
      ({ phaseId, lotId, drawIndex }) =>
        calendarSelectionKey(phaseId, lotId, drawIndex),
    ),
  )
  const selectedSelectionKeys = new Set(
    selectedSelections.map(
      ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`,
    ),
  )
  const utilityBillingMode = getUtilityBillingMode(schedule)
  const hardwareBillingMode = getHardwareBillingMode(schedule)
  const selectedLotDrawIndexes = [...new Set(
    lotSelectedSelections.map(({ drawIndex }) => Number(drawIndex)),
  )].sort((left, right) => left - right)
  const fullUtilityAnchorDrawIndex = selectedLotDrawIndexes[0] ?? null
  const fullUtilitySelections = utilityBillingMode === 'FULL'
    && fullUtilityAnchorDrawIndex !== null
    ? utilityRows.flatMap((row) => (
        fullUtilityRowIds.includes(String(row.id))
        && !billedUtilityCharges.has(utilityChargeKey(row.id, 'FULL'))
          ? [{
              phaseId: phase.id,
              lotId: row.id,
              drawIndex: fullUtilityAnchorDrawIndex,
            }]
          : []
      ))
    : []
  const suggestedSplitUtilitySelections = utilityBillingMode === 'BY_EVENT'
    ? utilityRows.flatMap((row) => {
        const selectionsByEvent = new Map()
        for (const selection of lotSelectedSelections) {
          const eventType = schedule?.draws?.[selection.drawIndex]?.eventType
          if (
            getUtilityEventPercentage(schedule, eventType) <= 0
            || selectionsByEvent.has(eventType)
            || billedUtilityCharges.has(
              utilityChargeKey(row.id, 'BY_EVENT', eventType),
            )
          ) continue
          selectionsByEvent.set(eventType, {
            phaseId: phase.id,
            lotId: row.id,
            drawIndex: selection.drawIndex,
          })
        }
        return [...selectionsByEvent.values()]
      })
    : []
  const splitUtilitySelections = suggestedSplitUtilitySelections.filter(
    ({ lotId, drawIndex }) => !excludedUtilityChargeKeys.includes(
      utilityChargeKey(
        lotId,
        'BY_EVENT',
        schedule?.draws?.[drawIndex]?.eventType,
      ),
    ),
  )
  const utilitySelections = utilityBillingMode === 'BY_EVENT'
    ? splitUtilitySelections
    : fullUtilitySelections
  const suggestedSplitHardwareSelections = hardwareBillingMode === 'BY_EVENT'
    ? calendarSuggestion.suggestedHardwareSelections.filter(
        ({ lotId, eventType }) => !billedHardwareCharges.has(
          hardwareChargeKey(lotId, 'BY_EVENT', eventType),
        ),
      )
    : []
  const suggestedSplitHardwareChargeKeys = new Set(
    suggestedSplitHardwareSelections.map(({ lotId, eventType }) => (
      hardwareChargeKey(lotId, 'BY_EVENT', eventType)
    )),
  )
  const selectedSplitHardwareChargeKeys = new Set(
    splitHardwareSelectionKeys ?? suggestedSplitHardwareChargeKeys,
  )
  const splitHardwareSelections = hardwareBillingMode === 'BY_EVENT'
    ? buildAvailableSeparateHardwareSelections({ job, schedule }).map((selection) => {
        const chargeKey = hardwareChargeKey(
          selection.lotId,
          'BY_EVENT',
          selection.eventType,
        )
        return {
          ...selection,
          isCalendarSuggested: suggestedSplitHardwareChargeKeys.has(chargeKey),
          chargeHardware: selectedSplitHardwareChargeKeys.has(chargeKey)
            && !billedHardwareCharges.has(chargeKey),
        }
      })
    : []
  const effectiveHardwareSelectionKeys = hardwareBillingMode === 'BY_EVENT'
    ? []
    : hardwareSelectionKeys
  const packageSelections = [...selectedSelections, ...utilitySelections]
  const selectedDrawIndexes = [...new Set(
    packageSelections.map(({ drawIndex }) => drawIndex),
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

  const pruneHardwareSelections = (selections) => {
    const availableKeys = new Set(selections.map(
      ({ phaseId, lotId, drawIndex }) => (
        hardwareSelectionKey(phaseId, lotId, drawIndex)
      ),
    ))
    setHardwareSelectionKeys((current) => current.filter(
      (key) => availableKeys.has(key),
    ))
  }

  const handleJobChange = (event) => {
    setSelectedJobId(event.target.value)
    setSelectedPhaseId('')
    setSelectedSelections(null)
    setHardwareSelectionKeys([])
    setSplitHardwareSelectionKeys(null)
    setFullUtilityRowIds([])
    setExcludedUtilityChargeKeys([])
    setExcludedOptionKeys([])
  }

  const handlePhaseChange = (event) => {
    setSelectedPhaseId(event.target.value)
    setSelectedSelections(null)
    setHardwareSelectionKeys([])
    setSplitHardwareSelectionKeys(null)
    setFullUtilityRowIds([])
    setExcludedUtilityChargeKeys([])
    setExcludedOptionKeys([])
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
    pruneHardwareSelections(nextSelections)
    setSelectedSelections(nextSelections)
  }

  const toggleFullUtilityCharge = (lotId) => {
    const key = String(lotId)
    if (billedUtilityCharges.has(utilityChargeKey(lotId, 'FULL'))) return
    setFullUtilityRowIds((current) => current.includes(key)
      ? current.filter((rowId) => rowId !== key)
      : [...current, key])
  }

  const toggleSplitUtilityCharge = (lotId, drawIndex) => {
    const eventType = schedule?.draws?.[drawIndex]?.eventType
    const key = utilityChargeKey(lotId, 'BY_EVENT', eventType)
    if (billedUtilityCharges.has(key)) return
    setExcludedUtilityChargeKeys((current) => current.includes(key)
      ? current.filter((chargeKey) => chargeKey !== key)
      : [...current, key])
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
    pruneHardwareSelections(nextSelections)
    setSelectedSelections(nextSelections)
  }

  const toggleHardwareSelection = (hardware) => {
    const chargeKey = hardwareChargeKey(
      hardware.lotId,
      hardwareBillingMode,
      hardware.hardwareEventType ?? hardware.eventType,
    )
    if (billedHardwareCharges.has(chargeKey)) return

    if (hardwareBillingMode === 'BY_EVENT') {
      setSplitHardwareSelectionKeys((current) => {
        const next = new Set(current ?? suggestedSplitHardwareChargeKeys)
        if (next.has(chargeKey)) {
          next.delete(chargeKey)
        } else {
          next.add(chargeKey)
        }
        return [...next]
      })
      return
    }

    setHardwareSelectionKeys((current) => {
      if (current.includes(hardware.selectionKey)) {
        return current.filter((key) => key !== hardware.selectionKey)
      }

      const lotPrefix = `${hardware.phaseId}:${hardware.lotId}:`
      return [
        ...current.filter((key) => !key.startsWith(lotPrefix)),
        hardware.selectionKey,
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
    const available = lotRows
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
    lotIds: packageSelections.map(({ lotId }) => lotId),
    drawIndexes: selectedDrawIndexes,
    optionsBillingDrawIndex: schedule?.optionsBillingDrawIndex ?? null,
    selections: packageSelections,
    hardwareSelections: splitHardwareSelections,
    hardwareSelectionKeys: effectiveHardwareSelectionKeys,
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
    [
      ...selectedSelections,
      ...splitHardwareSelections.filter((selection) => selection.chargeHardware),
    ]
      .map(({ phaseId }) => String(phaseId)),
  )
  const selectedPhasesAreReady = phases
    .filter((candidate) => selectedPhaseIds.has(String(candidate.id)))
    .every((candidate) => buildDrawWorksheet(job, candidate, schedule).isReady)
  const canCreate =
    hasScope &&
    selectedPhasesAreReady &&
    (packageSelections.length > 0 || summary.hardwareIsDue) &&
    summary.unpricedOptionCount === 0

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onCreate({
        jobId: job.id,
        selections: packageSelections,
        hardwareSelections: summary.hardwareRows
          .filter((row) => row.chargeHardware)
          .map(({ phaseId, lotId, drawIndex, hardwareEventType }) => ({
            phaseId,
            lotId,
            drawIndex,
            eventType: hardwareEventType,
          })),
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
              helperText={job ? undefined : 'Select a Job first'}
              fullWidth
            >
              {phases.map((candidate) => (
                <MenuItem key={candidate.id} value={String(candidate.id)}>
                  {formatPhase(candidate.name)} · {formatBuilding(candidate.building)} ·{' '}
                  {(candidate.lots ?? []).filter((row) => !row.isUtilityBuilding).length} lots
                  {(candidate.lots ?? []).some((row) => row.isUtilityBuilding)
                    ? ` · ${(candidate.lots ?? []).filter((row) => row.isUtilityBuilding).length} Utility`
                    : ''}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {!hasScope && (
            <Alert severity="info">
              Select a Job and a Phase / Building to see its Lots, Draws and
              Calendar suggestion.
            </Alert>
          )}

          {hasScope && !worksheet.isReady && (
            <Alert severity="warning">
              {readinessLabel(worksheet)}. Complete the worksheet prerequisites
              before creating a package.
            </Alert>
          )}

          {hasScope && lotRows.length > 0 && productionActivitiesLoading && (
            <Alert severity="info">
              Loading Calendar work to prepare the Package suggestion…
            </Alert>
          )}

          {hasScope && lotRows.length > 0 && !productionActivitiesLoading && productionActivitiesError && (
            <Alert severity="warning">
              Calendar suggestions are unavailable: {productionActivitiesError}
              {' '}You can still select Lot / Draw cells manually.
            </Alert>
          )}

          {hasScope && lotRows.length > 0 && !productionActivitiesLoading
            && !productionActivitiesError
            && calendarSuggestion.eligibleSelections.length === 0
            && calendarSuggestion.eligibleHardwareSelections.length === 0 && (
              <Alert severity="info">
                {calendarSuggestion.mode === 'ANY_DATE'
                  ? 'There are no open Calendar Draw or Separate Hardware charges scheduled through today.'
                  : `There are no open Calendar Draw or Separate Hardware charges scheduled on or before ${formatLongDate(calendarSuggestion.cutoffDate)}.`}
                {' '}You can still select cells manually.
              </Alert>
          )}

          {hasScope && lotRows.length > 0 && !productionActivitiesLoading
            && !productionActivitiesError
            && (calendarSuggestion.eligibleSelections.length > 0
              || calendarSuggestion.eligibleHardwareSelections.length > 0) && (
              <Alert severity="success">
                {calendarSuggestion.mode === 'ANY_DATE' ? (
                  <>
                    <strong>Any date suggestion:</strong>{' '}
                    {formatLongDate(calendarSuggestion.windowStart)}–{formatLongDate(calendarSuggestion.windowEnd)}
                    {' '}is the highest-value rolling 14-day window.{' '}
                    <strong>{calendarSuggestion.suggestedSelections.length
                      + calendarSuggestion.suggestedHardwareSelections.length}</strong>{' '}
                    billing items are preselected for an estimated{' '}
                    <strong>{formatCurrency(calendarSuggestion.estimatedInvoiceAmount)}</strong>
                    {' '}invoice.
                    {calendarSuggestion.eligibleSelections.length
                      + calendarSuggestion.eligibleHardwareSelections.length
                      > calendarSuggestion.suggestedSelections.length
                        + calendarSuggestion.suggestedHardwareSelections.length && (
                        <>
                          {' '}{calendarSuggestion.eligibleSelections.length
                            + calendarSuggestion.eligibleHardwareSelections.length
                            - calendarSuggestion.suggestedSelections.length
                            - calendarSuggestion.suggestedHardwareSelections.length}{' '}
                          other Calendar-ready cells remain available.
                        </>
                      )}
                  </>
                ) : (
                  <>
                    <strong>Calendar suggestion · cutoff{' '}
                      {formatLongDate(calendarSuggestion.cutoffDate)}:</strong>{' '}
                    {calendarSuggestion.suggestedSelections.length} open Lot / Draw cells
                    {' '}and {calendarSuggestion.suggestedHardwareSelections.length}{' '}
                    Separate Hardware charges
                    {' '}for {calendarSuggestion.eventTypes.join(' / ')} are preselected.{' '}
                    Estimated invoice:{' '}
                    <strong>{formatCurrency(calendarSuggestion.estimatedInvoiceAmount)}</strong>.
                  </>
                )}
              </Alert>
          )}

          {hasScope && lotRows.length > 0 && (
            <DrawSelectionGrid
              job={job}
              phase={phase}
              worksheet={lotWorksheet}
              drawCalendarHeadings={drawCalendarHeadings}
              usedSelections={usedSelections}
              selectedSelections={lotSelectedSelections}
              selectionIsUsed={selectionIsUsed}
              selectionIsSelected={selectionIsSelected}
              calendarReadySelectionKeys={calendarReadySelectionKeys}
              suggestedSelectionKeys={suggestedSelectionKeys}
              toggleSelection={toggleSelection}
              toggleLotSelections={toggleLotSelections}
              toggleDrawSelections={toggleDrawSelections}
            />
          )}

          {hasScope && utilityRows.length > 0 && (
            <CreatePackageUtilityTable
              phase={phase}
              worksheet={utilityWorksheet}
              drawCalendarHeadings={drawCalendarHeadings}
              selectedUtilitySelections={utilitySelections}
              selectedLotDrawIndexes={selectedLotDrawIndexes}
              billedUtilityCharges={billedUtilityCharges}
              fullUtilityRowIds={fullUtilityRowIds}
              fullUtilityAnchorDrawIndex={fullUtilityAnchorDrawIndex}
              onToggleFull={toggleFullUtilityCharge}
              onToggleSplit={toggleSplitUtilityCharge}
            />
          )}

          {hasScope && (
            <CreatePackageHardwareTable
              summary={summary}
              billedHardwareCharges={billedHardwareCharges}
              onToggle={toggleHardwareSelection}
            />
          )}

          {hasScope && summary.optionsAreDue && (
            <SelectableOptionsTable summary={summary} onToggle={toggleOption} />
          )}

          {hasScope && summary.optionsAreDue && summary.selectedOptionRows.length > 0 && (
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
                          {[
                            draw.lotRange ? `Lots ${draw.lotRange}` : null,
                            draw.utilityCount > 0
                              ? `${draw.utilityCount} Utility ${draw.utilityCount === 1 ? 'row' : 'rows'}`
                              : null,
                            `Draw #${draw.drawIndex + 1}`,
                          ].filter(Boolean).join(' · ')}
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
                    {/* <strong>{summary.scopeCount}</strong> billing scopes */}
                    {summary.lotCount > 0 && (
                      <> <strong>{summary.lotCount}</strong> lots</>
                    )}
                  </Typography>
                  {summary.utilityCount > 0 && (
                    <Typography variant="body2">
                      Utility Building: <strong>{summary.utilityCount}</strong>{' '}
                      {summary.utilityCount === 1 ? 'row' : 'rows'} ·{' '}
                      <strong>{formatCurrency(summary.utilityTotal)}</strong>
                    </Typography>
                  )}
                  <Typography variant="body2">
                    Current Draw: <strong>{formatCurrency(summary.currentDraw)}</strong>
                  </Typography>
                  {summary.optionsAreDue && (
                    <Typography variant="body2">
                      Options: <strong>{formatCurrency(summary.optionsTotal)}</strong>
                    </Typography>
                  )}
                  {summary.hardwareIsDue && (
                    <Typography variant="body2">
                      Hardware: <strong>{formatCurrency(summary.hardwareTotal)}</strong>
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
