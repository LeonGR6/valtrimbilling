import { lazy, Suspense, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Backdrop,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import {
  getJobBuilderId,
  jobPlanPricingPath,
} from '../../../jobs/utils/jobRoutes.js'
import { formatPhaseBuilding } from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import {
  buildBilledHardwareCharges,
  buildBilledUtilityCharges,
  buildOptionChargeContext,
  buildUsedDrawSelections,
  drawSelectionKey,
  hardwareChargeKey,
  hardwareSelectionKey,
  optionSelectionKey,
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
  localDateKey,
} from '../../utils/calendarDrawSuggestions.js'
import {
  hardwareChargeKeyOfCell,
  hardwareChargesAfterCellChange,
} from '../../utils/packageHardwareLink.js'
import { excludedOptionsAfterCellChange } from '../../utils/packageOptionLink.js'
import { formatLag } from '../../../builder-draw-schedules/utils/drawLag.js'
import {
  initialShownPhaseIds,
  isMultiPhasePackage,
  packagePhaseLabels,
  phaseBillingProgress,
  sortPhasesForPicking,
} from '../../utils/packagePhaseScope.js'
import { useAuth } from '../../../auth/context/useAuth.js'
import { usePurchaseOrderBacking } from '../../../purchase-orders/hooks/usePurchaseOrders.js'
import { usePreliminaryNoticeGate } from '../../hooks/usePreliminaryNoticeGate.js'
import DrawSelectionGrid from './DrawSelectionGrid.jsx'
import CreatePackageHardwareTable from './CreatePackageHardwareTable.jsx'
import CreatePackageTotals from './CreatePackageTotals.jsx'
import CreatePackageUtilityTable from './CreatePackageUtilityTable.jsx'
import SelectableOptionsTable from './SelectableOptionsTable.jsx'

const PreliminaryNoticeEditorDialog = lazy(
  () => import('../documents/PreliminaryNoticeEditorDialog.jsx'),
)

// The roles that can save a Job's documents, the notice included.
const NOTICE_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']

const cellKey = ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`

function resolveSchedule(job, jobBillingSetupVersions, schedules) {
  return jobBillingSetupVersions.find(
    (candidate) => String(candidate.id) === String(job?.billingSetupVersionId),
  ) ?? schedules.find(
    (candidate) => String(candidate.builderId) === String(getJobBuilderId(job)),
  )
}

function phaseLotCounts(phase) {
  const lots = phase.lots ?? []
  const utility = lots.filter((row) => row.isUtilityBuilding).length
  return { lots: lots.length - utility, utility }
}

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
  // user picks the Job and every Phase / Building the Package should cover.
  // A Package Suggestion opens it with the Job and its suggested Phases chosen.
  const initialJob = initialJobId == null
    ? null
    : jobs.find((candidate) => String(candidate.id) === String(initialJobId))
  const [selectedJobId, setSelectedJobId] = useState(
    initialJob == null ? '' : String(initialJob.id),
  )
  const [shownPhaseIds, setShownPhaseIds] = useState(() => initialShownPhaseIds({
    job: initialJob,
    initialPhaseId,
    schedule: resolveSchedule(initialJob, jobBillingSetupVersions, schedules),
    productionActivities,
    packages,
    asOfDate: localDateKey(),
  }))
  const [selectionOverrides, setSelectedSelections] = useState(null)
  const [hardwareSelectionKeys, setHardwareSelectionKeys] = useState([])
  const [splitHardwareSelectionKeys, setSplitHardwareSelectionKeys] = useState(null)
  const [fullUtilityRowIds, setFullUtilityRowIds] = useState([])
  const [excludedUtilityChargeKeys, setExcludedUtilityChargeKeys] = useState([])
  const [excludedOptionKeys, setExcludedOptionKeys] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [asOfDate] = useState(() => localDateKey())
  const [noticeEditorOpen, setNoticeEditorOpen] = useState(false)
  const [completedOpen, setCompletedOpen] = useState(false)
  const { profile } = useAuth()

  const job = jobs.find((candidate) => String(candidate.id) === selectedJobId)
  const purchaseOrderBacking = usePurchaseOrderBacking(job?.id ?? null)
  const phases = sortPhasesForPicking(job?.sequenceSheet?.phases ?? [])
  const shownPhaseIdSet = new Set(shownPhaseIds)
  const shownPhases = phases.filter(
    (candidate) => shownPhaseIdSet.has(String(candidate.id)),
  )
  const hasScope = Boolean(job && shownPhases.length > 0)
  const schedule = resolveSchedule(job, jobBillingSetupVersions, schedules)
  const usedSelections = useMemo(
    () => buildUsedDrawSelections(packages),
    [packages],
  )
  const billedHardwareCharges = buildBilledHardwareCharges(packages, job?.id)
  const billedUtilityCharges = buildBilledUtilityCharges(packages, job?.id)
  // Phases whose every cell and charge is already in a Package go to their own
  // collapsed section, so the ones that still have something to bill come first.
  const progressByPhaseId = new Map(phases.map((candidate) => [
    String(candidate.id),
    phaseBillingProgress({
      job,
      phase: candidate,
      schedule,
      usedSelections,
      billedUtilityCharges,
      billedHardwareCharges,
    }),
  ]))
  // A Phase already added to the Package stays among the chips so it can be removed.
  const isCollapsedAsComplete = (candidate) => (
    progressByPhaseId.get(String(candidate.id)).isComplete
    && !shownPhaseIdSet.has(String(candidate.id))
  )
  const openPhases = phases.filter((candidate) => !isCollapsedAsComplete(candidate))
  const completedPhases = phases.filter(isCollapsedAsComplete)
  const calendarSuggestion = buildCalendarDrawSuggestion({
    activities: productionActivities,
    job,
    schedule,
    packages,
    asOfDate,
  })
  // Suggestions only count for the Phases that are on screen.
  const suggestedSelections = calendarSuggestion.suggestedSelections.filter(
    ({ phaseId }) => shownPhaseIdSet.has(String(phaseId)),
  )
  const selectedSelections = selectionOverrides ?? suggestedSelections
  const calendarReadySelectionKeys = new Set(
    calendarSuggestion.eligibleSelections.map(cellKey),
  )
  const suggestedSelectionKeys = new Set(
    calendarSuggestion.suggestedSelections.map(cellKey),
  )
  const selectedSelectionKeys = new Set(selectedSelections.map(cellKey))
  const utilityBillingMode = getUtilityBillingMode(schedule)
  const hardwareBillingMode = getHardwareBillingMode(schedule)

  // Everything one Phase / Building section needs: its own worksheet, its
  // selected Lot cells and the Utility charges that follow from them.
  const buildPhaseModel = (candidate) => {
    const sheet = buildDrawWorksheet(job, candidate, schedule)
    const lotRows = sheet.rows.filter((row) => !row.isUtilityBuilding)
    const utilityRows = sheet.rows.filter((row) => row.isUtilityBuilding)
    const lotRowIds = new Set(lotRows.map((row) => String(row.id)))
    const lotSelected = selectedSelections.filter(
      (selection) => lotRowIds.has(String(selection.lotId)),
    )
    const selectedLotDrawIndexes = [...new Set(
      lotSelected.map(({ drawIndex }) => Number(drawIndex)),
    )].sort((left, right) => left - right)
    const anchorDrawIndex = selectedLotDrawIndexes[0] ?? null
    const fullUtilitySelections = utilityBillingMode === 'FULL'
      && anchorDrawIndex !== null
      ? utilityRows.flatMap((row) => (
          fullUtilityRowIds.includes(String(row.id))
          && !billedUtilityCharges.has(utilityChargeKey(row.id, 'FULL'))
            ? [{ phaseId: candidate.id, lotId: row.id, drawIndex: anchorDrawIndex }]
            : []
        ))
      : []
    const suggestedSplitUtilitySelections = utilityBillingMode === 'BY_EVENT'
      ? utilityRows.flatMap((row) => {
          const selectionsByEvent = new Map()
          for (const selection of lotSelected) {
            const eventType = schedule?.draws?.[selection.drawIndex]?.eventType
            if (
              getUtilityEventPercentage(schedule, eventType) <= 0
              || selectionsByEvent.has(eventType)
              || billedUtilityCharges.has(
                utilityChargeKey(row.id, 'BY_EVENT', eventType),
              )
            ) continue
            selectionsByEvent.set(eventType, {
              phaseId: candidate.id,
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

    return {
      phase: candidate,
      worksheet: sheet,
      lotRows,
      utilityRows,
      lotWorksheet: { ...sheet, rows: lotRows },
      utilityWorksheet: { ...sheet, rows: utilityRows },
      lotSelected,
      selectedLotDrawIndexes,
      anchorDrawIndex,
      utilitySelections: utilityBillingMode === 'BY_EVENT'
        ? splitUtilitySelections
        : fullUtilitySelections,
      headings: buildDrawCalendarHeadings({
        activities: productionActivities,
        job,
        phase: candidate,
        schedule,
      }),
    }
  }
  const phaseModels = shownPhases.map(buildPhaseModel)
  // Selected cells of a Draw billed some time after its event, before that time
  // has passed. They can still be packaged: the Calendar only suggests them later.
  const todayKey = localDateKey()
  const lagNotices = [...phaseModels.reduce((notices, model) => {
    for (const drawIndex of new Set(model.lotSelected.map((selection) => selection.drawIndex))) {
      const heading = model.headings[drawIndex]
      const availableFrom = heading?.availableDates?.[0]
      if (!heading?.lag || !availableFrom || availableFrom <= todayKey) continue
      const known = notices.get(drawIndex)
      if (!known || availableFrom < known.availableFrom) {
        notices.set(drawIndex, { drawIndex, lag: heading.lag, eventType: heading.eventType, availableFrom })
      }
    }
    return notices
  }, new Map()).values()].sort((left, right) => left.drawIndex - right.drawIndex)
  const utilitySelections = phaseModels.flatMap((model) => model.utilitySelections)

  const suggestedSplitHardwareSelections = hardwareBillingMode === 'BY_EVENT'
    ? calendarSuggestion.suggestedHardwareSelections.filter(
        ({ phaseId, lotId, eventType }) => (
          shownPhaseIdSet.has(String(phaseId))
          && !billedHardwareCharges.has(
            hardwareChargeKey(lotId, 'BY_EVENT', eventType),
          )
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
  // The Hardware portions whose Lot Draw is selected.
  const drawHardwareChargeKeys = new Set(
    selectedSelections.map((cell) => hardwareChargeKeyOfCell(schedule, cell)),
  )
  const splitHardwareSelections = hardwareBillingMode === 'BY_EVENT'
    ? buildAvailableSeparateHardwareSelections({ job, schedule })
        .filter(({ phaseId }) => shownPhaseIdSet.has(String(phaseId)))
        .map((selection) => {
          const chargeKey = hardwareChargeKey(
            selection.lotId,
            'BY_EVENT',
            selection.eventType,
          )
          return {
            ...selection,
            isCalendarSuggested: suggestedSplitHardwareChargeKeys.has(chargeKey),
            isDrawSelected: drawHardwareChargeKeys.has(chargeKey),
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

  const selectionIsUsed = (phaseId, lotId, drawIndex) =>
    usedSelections.has(drawSelectionKey(job?.id, phaseId, lotId, drawIndex))

  const selectionIsSelected = (phaseId, lotId, drawIndex) =>
    selectedSelectionKeys.has(`${phaseId}:${lotId}:${drawIndex}`)

  const optionKeysOfLot = (phaseId, lotId) => {
    const row = phaseModels
      .find((model) => String(model.phase.id) === String(phaseId))
      ?.worksheet.rows.find((candidate) => String(candidate.id) === String(lotId))

    return (row?.selectedOptions ?? []).map(
      (option) => optionSelectionKey(phaseId, lotId, option.id),
    )
  }

  // A Lot that reaches the Options billing Draw has its Options selected, and one
  // that no longer reaches it has them cleared. Each Option can still be changed on its own.
  const followOptions = (previousCells, nextCells) => {
    setExcludedOptionKeys((current) => excludedOptionsAfterCellChange({
      schedule,
      excludedKeys: current,
      previousCells,
      nextCells,
      optionKeysOfLot,
    }))
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

  // Selecting a Lot's Draw selects the Hardware portion of its event, and clearing
  // the Draw clears the portion. The portion can still be changed on its own.
  const followHardware = (previousCells, nextCells) => {
    if (hardwareBillingMode !== 'BY_EVENT') return

    setSplitHardwareSelectionKeys((current) => hardwareChargesAfterCellChange({
      schedule,
      chargeKeys: current ?? suggestedSplitHardwareChargeKeys,
      previousCells,
      nextCells,
      billedChargeKeys: billedHardwareCharges,
    }))
  }

  const resetPackageChoices = () => {
    setSelectedSelections(null)
    setHardwareSelectionKeys([])
    setSplitHardwareSelectionKeys(null)
    setFullUtilityRowIds([])
    setExcludedUtilityChargeKeys([])
    setExcludedOptionKeys([])
  }

  const handleJobChange = (event) => {
    setSelectedJobId(event.target.value)
    setShownPhaseIds([])
    resetPackageChoices()
  }

  // Adding Phases brings the Calendar's suggested cells for them along.
  const addPhases = (phaseIds) => {
    const ids = phaseIds.map(String).filter((id) => !shownPhaseIdSet.has(id))
    if (ids.length === 0) return

    setShownPhaseIds((current) => [...current, ...ids])
    if (selectionOverrides !== null) {
      const known = new Set(selectionOverrides.map(cellKey))
      const nextSelections = [
        ...selectionOverrides,
        ...calendarSuggestion.suggestedSelections.filter(
          (selection) => ids.includes(String(selection.phaseId))
            && !known.has(cellKey(selection)),
        ),
      ]
      followHardware(selectionOverrides, nextSelections)
      followOptions(selectionOverrides, nextSelections)
      setSelectedSelections(nextSelections)
    }
  }

  // Removing a Phase also removes the cells and charges it contributed.
  const removePhase = (candidate) => {
    const id = String(candidate.id)
    const lotIds = new Set((candidate.lots ?? []).map((lot) => String(lot.id)))
    const nextSelections = selectedSelections.filter(
      (selection) => String(selection.phaseId) !== id,
    )

    setShownPhaseIds((current) => current.filter((value) => value !== id))
    setSelectedSelections(nextSelections)
    setSplitHardwareSelectionKeys((current) => current === null
      ? null
      : current.filter((key) => !lotIds.has(key.split(':')[0])))
    setExcludedOptionKeys((current) => current.filter((key) => !key.startsWith(`${id}:`)))
    pruneHardwareSelections(nextSelections)
  }

  const toggleSelection = (candidate, lotId, drawIndex) => {
    if (selectionIsUsed(candidate.id, lotId, drawIndex)) return

    const key = `${candidate.id}:${lotId}:${drawIndex}`
    const nextSelections = selectedSelections.some(
      (selection) => cellKey(selection) === key,
    )
      ? selectedSelections.filter((selection) => cellKey(selection) !== key)
      : [...selectedSelections, { phaseId: candidate.id, lotId, drawIndex }]

    followOptions(selectedSelections, nextSelections)
    pruneHardwareSelections(nextSelections)
    followHardware(selectedSelections, nextSelections)
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
    const availableKeys = new Set(available.map(cellKey))
    const allSelected = available.length > 0 && available.every(
      (selection) => selectedSelectionKeys.has(cellKey(selection)),
    )
    const nextSelections = allSelected
      ? selectedSelections.filter(
        (selection) => !availableKeys.has(cellKey(selection)),
      )
      : [
          ...selectedSelections,
          ...available.filter(
            (selection) => !selectedSelectionKeys.has(cellKey(selection)),
          ),
        ]

    followOptions(selectedSelections, nextSelections)
    pruneHardwareSelections(nextSelections)
    followHardware(selectedSelections, nextSelections)
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

  const toggleLotSelections = (model, lotId) => {
    toggleSelectionGroup(
      model.worksheet.draws
        .map((_, drawIndex) => ({ phaseId: model.phase.id, lotId, drawIndex }))
        .filter(({ drawIndex }) => !selectionIsUsed(model.phase.id, lotId, drawIndex)),
    )
  }

  const toggleDrawSelections = (model, drawIndex) => {
    toggleSelectionGroup(
      model.lotRows
        .map((row) => ({ phaseId: model.phase.id, lotId: row.id, drawIndex }))
        .filter(({ lotId }) => !selectionIsUsed(model.phase.id, lotId, drawIndex)),
    )
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
  const packagePhaseLabelList = packagePhaseLabels(summary.phaseSummaries)
  const isMultiPhase = isMultiPhasePackage(summary.phaseCount)

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
  const selectedPhasesAreReady = phaseModels
    .filter((model) => selectedPhaseIds.has(String(model.phase.id)))
    .every((model) => model.worksheet.isReady)
  // A Package needs the Job's Preliminary Notice filled in.
  const noticeGate = usePreliminaryNoticeGate(job?.id)
  const canCreate =
    !noticeGate.blocked &&
    hasScope &&
    selectedPhasesAreReady &&
    (packageSelections.length > 0 || summary.hardwareIsDue) &&
    summary.unpricedOptionCount === 0

  const hasLotRows = phaseModels.some((model) => model.lotRows.length > 0)
  const calendarIsReady = hasScope && hasLotRows && !productionActivitiesLoading
    && !productionActivitiesError
  const hiddenSuggestedPhaseIds = [...new Set([
    ...calendarSuggestion.suggestedSelections,
    ...calendarSuggestion.suggestedHardwareSelections,
  ].map(({ phaseId }) => String(phaseId)))].filter(
    (id) => !shownPhaseIdSet.has(id),
  )

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

  const renderPhaseChip = (candidate) => {
    const id = String(candidate.id)
    const shown = shownPhaseIdSet.has(id)
    const counts = phaseLotCounts(candidate)
    const cellCount = selectedSelections.filter(
      (selection) => String(selection.phaseId) === id,
    ).length

    return (
      <Chip
        key={candidate.id}
        clickable
        color={shown ? 'primary' : 'default'}
        variant={shown ? 'filled' : 'outlined'}
        icon={shown ? <CheckRoundedIcon /> : <AddRoundedIcon />}
        onClick={() => (shown ? removePhase(candidate) : addPhases([candidate.id]))}
        title={shown
          ? 'Remove this Phase and its selected cells from the Package'
          : 'Add this Phase to the Package'}
        label={[
          formatPhaseBuilding(candidate.name, candidate.building),
          `${counts.lots} lots`,
          counts.utility > 0 ? `${counts.utility} Utility` : null,
          cellCount > 0 ? `${cellCount} ${cellCount === 1 ? 'cell' : 'cells'}` : null,
        ].filter(Boolean).join(' · ')}
      />
    )
  }

  return (
    <Dialog open fullScreen onClose={onClose}>
      <DialogTitle
        sx={{
          px: 3,
          py: 1.75,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1.25}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="h6" component="div" fontWeight={800}>
            Create Draw Package
          </Typography>
          {isMultiPhase && (
            <Chip
              size="small"
              color="warning"
              icon={<LayersRoundedIcon />}
              label={`Multi-phase · ${summary.phaseCount} Phases / Buildings`}
              sx={{ fontWeight: 750 }}
            />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          A Draw Package creates one persisted package, its immutable calculated lines,
          and an invoice total snapshot.
        </Typography>
        </Box>
        <IconButton aria-label="Close" onClick={onClose} edge="end" sx={{ mt: -0.5 }}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, md: 3 }, py: '20px !important', bgcolor: 'background.default' }}>
        <Stack spacing={2.5} sx={{ width: '100%', maxWidth: 1480, mx: 'auto' }}>
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
          <Stack spacing={2.5}>
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

          {job && noticeGate.status === 'missing' && (
            <Alert
              severity="warning"
              action={NOTICE_ROLES.includes(profile?.role) && (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setNoticeEditorOpen(true)}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  Add Preliminary Notice
                </Button>
              )}
            >
              <strong>Job #{job.code} has no Preliminary Notice.</strong> Fill it in
              before creating a Package. You can also do it from the Documents tab.
            </Alert>
          )}
          {job && noticeGate.status === 'error' && (
            <Alert severity="info">
              The Preliminary Notice of this Job could not be checked ({noticeGate.error}).
              It is checked again when the Package is created.
            </Alert>
          )}

          <Box>
            <Typography fontWeight={800}>Phases / Buildings in this Package</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              {job
                ? 'Select every Phase / Building to include. Each one appears below, and they are all billed together in one invoice.'
                : 'Select a Job first.'}
            </Typography>
            {job && phases.length === 0 && (
              <Alert severity="warning">
                This Job has no Phases yet. Create a Phase and assign its Lots in
                Sequence Sheets first.
              </Alert>
            )}
            {job && phases.length > 0 && openPhases.length === 0 && (
              <Alert severity="success" icon={<CheckCircleRoundedIcon />}>
                <strong>Every Phase / Building of this Job is fully billed.</strong>{' '}
                There is nothing left to include in a new Package.
              </Alert>
            )}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {openPhases.map(renderPhaseChip)}
            </Stack>

            {completedPhases.length > 0 && (
              <Accordion
                disableGutters
                variant="outlined"
                expanded={completedOpen}
                onChange={(_, expanded) => setCompletedOpen(expanded)}
                sx={{ mt: 1.75, borderRadius: 2, '&:before': { display: 'none' } }}
              >
                <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <CheckCircleRoundedIcon color="success" fontSize="small" />
                    <Typography fontWeight={750}>
                      Completed Phases / Buildings ({completedPhases.length})
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Everything is already billed
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                  <Stack spacing={0.75}>
                    {completedPhases.map((candidate) => {
                      const progress = progressByPhaseId.get(String(candidate.id))
                      return (
                        <Stack
                          key={candidate.id}
                          direction="row"
                          spacing={1.5}
                          useFlexGap
                          sx={{
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            py: 0.75,
                            borderTop: 1,
                            borderColor: 'divider',
                          }}
                        >
                          <Typography variant="body2" fontWeight={800} sx={{ minWidth: 200 }}>
                            {formatPhaseBuilding(candidate.name, candidate.building)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {[
                              `${progress.lotCount} ${progress.lotCount === 1 ? 'lot' : 'lots'}`,
                              `${progress.billedCells} of ${progress.totalCells} Lot / Draw cells billed`,
                              progress.utilityCount > 0
                                ? `${progress.utilityCount} Utility ${progress.utilityCount === 1 ? 'row' : 'rows'} billed`
                                : null,
                              progress.totalHardware > 0
                                ? `${progress.billedHardware} Separate Hardware ${progress.billedHardware === 1 ? 'charge' : 'charges'}`
                                : null,
                            ].filter(Boolean).join(' · ')}
                          </Typography>
                        </Stack>
                      )
                    })}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            )}
          </Box>
          </Stack>
          </Paper>

          {isMultiPhase && (
            <Alert severity="warning" icon={<LayersRoundedIcon />}>
              <strong>Multi-phase Package.</strong> This Package bills{' '}
              {summary.phaseCount} Phases / Buildings together on one invoice:{' '}
              {packagePhaseLabelList.join(' · ')}.
            </Alert>
          )}

          {!hasScope && (
            <Alert severity="info">
              {job
                ? 'Select at least one Phase / Building to see its Lots, Draws and Calendar suggestion.'
                : 'Select a Job and its Phases / Buildings to see their Lots, Draws and Calendar suggestion.'}
            </Alert>
          )}

          {hasScope && hasLotRows && productionActivitiesLoading && (
            <Alert severity="info">
              Loading Calendar work to prepare the Package suggestion…
            </Alert>
          )}

          {hasScope && hasLotRows && !productionActivitiesLoading && productionActivitiesError && (
            <Alert severity="warning">
              Calendar suggestions are unavailable: {productionActivitiesError}
              {' '}You can still select Lot / Draw cells manually.
            </Alert>
          )}

          {calendarIsReady
            && calendarSuggestion.eligibleSelections.length === 0
            && calendarSuggestion.eligibleHardwareSelections.length === 0 && (
              <Alert severity="info">
                {calendarSuggestion.mode === 'ANY_DATE'
                  ? 'There are no open Calendar Draw or Separate Hardware charges scheduled through today.'
                  : `There are no open Calendar Draw or Separate Hardware charges scheduled on or before ${formatLongDate(calendarSuggestion.cutoffDate)}.`}
                {' '}You can still select cells manually.
              </Alert>
          )}

          {lagNotices.length > 0 && (
            <Alert severity="warning">
              {lagNotices.map(({ drawIndex, lag, eventType, availableFrom }) => (
                <Box key={drawIndex}>
                  <strong>Draw #{drawIndex + 1}</strong> is billed {formatLag(lag)} after{' '}
                  {eventType}, so it is not billable until {formatLongDate(availableFrom)}.
                </Box>
              ))}
              You can still include it in this Package.
            </Alert>
          )}

          {calendarIsReady
            && (calendarSuggestion.eligibleSelections.length > 0
              || calendarSuggestion.eligibleHardwareSelections.length > 0) && (
              <Alert
                severity="success"
                action={hiddenSuggestedPhaseIds.length > 0 ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => addPhases(hiddenSuggestedPhaseIds)}
                  >
                    Add {hiddenSuggestedPhaseIds.length}{' '}
                    {hiddenSuggestedPhaseIds.length === 1 ? 'Phase' : 'Phases'}
                  </Button>
                ) : undefined}
              >
                {calendarSuggestion.mode === 'ANY_DATE' ? (
                  <>
                    <strong>Any date suggestion:</strong>{' '}
                    {formatLongDate(calendarSuggestion.windowStart)}–{formatLongDate(calendarSuggestion.windowEnd)}
                    {' '}is the highest-value rolling 14-day window.{' '}
                    <strong>{calendarSuggestion.suggestedSelections.length
                      + calendarSuggestion.suggestedHardwareSelections.length}</strong>{' '}
                    billing items are suggested for an estimated{' '}
                    <strong>{formatCurrency(calendarSuggestion.estimatedInvoiceAmount)}</strong>
                    {' '}invoice
                    {calendarSuggestion.overdueCount > 0
                      ? `, including ${calendarSuggestion.overdueCount} overdue ${calendarSuggestion.overdueCount === 1 ? 'item' : 'items'} from before that window`
                      : ''}
                    {'.'}
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
                    {' '}for {calendarSuggestion.eventTypes.join(' / ')} are suggested.{' '}
                    Estimated invoice:{' '}
                    <strong>{formatCurrency(calendarSuggestion.estimatedInvoiceAmount)}</strong>.
                  </>
                )}
                {hiddenSuggestedPhaseIds.length > 0 && (
                  <>
                    {' '}Some of that work is in{' '}
                    {hiddenSuggestedPhaseIds.length}{' '}
                    {hiddenSuggestedPhaseIds.length === 1 ? 'Phase' : 'Phases'} not added yet.
                  </>
                )}
              </Alert>
          )}

          {phaseModels.map((model, index) => {
            const { phase } = model
            const phaseKeyPrefix = `${phase.id}:`
            const phaseSuggestedKeys = new Set(
              [...suggestedSelectionKeys].filter((key) => key.startsWith(phaseKeyPrefix)),
            )
            const phaseReadyKeys = new Set(
              [...calendarReadySelectionKeys].filter((key) => key.startsWith(phaseKeyPrefix)),
            )

            return (
              <Stack
                key={phase.id}
                spacing={2}
                sx={phaseModels.length > 1 ? {
                  pl: 2,
                  borderLeft: 4,
                  borderColor: 'primary.main',
                } : undefined}
              >
                {phaseModels.length > 1 && (
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Chip size="small" color="primary" label={`${index + 1} of ${phaseModels.length}`} />
                    <Typography variant="subtitle1" fontWeight={850}>
                      {formatPhaseBuilding(phase.name, phase.building)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {model.lotRows.length} lots
                      {model.utilityRows.length > 0
                        ? ` · ${model.utilityRows.length} Utility`
                        : ''}
                    </Typography>
                  </Stack>
                )}

                {!model.worksheet.isReady && (
                  <Alert severity="warning">
                    {formatPhaseBuilding(phase.name, phase.building)}:{' '}
                    {readinessLabel(model.worksheet)}. Complete the worksheet
                    prerequisites before creating a package.
                  </Alert>
                )}

                {model.lotRows.length > 0 && (
                  <DrawSelectionGrid
                    job={job}
                    phase={phase}
                    worksheet={model.lotWorksheet}
                    drawCalendarHeadings={model.headings}
                    usedSelections={usedSelections}
                    selectedSelections={model.lotSelected}
                    selectionIsUsed={(lotId, drawIndex) => (
                      selectionIsUsed(phase.id, lotId, drawIndex)
                    )}
                    selectionIsSelected={(lotId, drawIndex) => (
                      selectionIsSelected(phase.id, lotId, drawIndex)
                    )}
                    calendarReadySelectionKeys={phaseReadyKeys}
                    suggestedSelectionKeys={phaseSuggestedKeys}
                    toggleSelection={(lotId, drawIndex) => (
                      toggleSelection(phase, lotId, drawIndex)
                    )}
                    toggleLotSelections={(lotId) => toggleLotSelections(model, lotId)}
                    toggleDrawSelections={(drawIndex) => toggleDrawSelections(model, drawIndex)}
                  />
                )}

                {model.utilityRows.length > 0 && (
                  <CreatePackageUtilityTable
                    phase={phase}
                    worksheet={model.utilityWorksheet}
                    drawCalendarHeadings={model.headings}
                    selectedUtilitySelections={model.utilitySelections}
                    selectedLotDrawIndexes={model.selectedLotDrawIndexes}
                    billedUtilityCharges={billedUtilityCharges}
                    fullUtilityRowIds={fullUtilityRowIds}
                    fullUtilityAnchorDrawIndex={model.anchorDrawIndex}
                    onToggleFull={toggleFullUtilityCharge}
                    onToggleSplit={toggleSplitUtilityCharge}
                  />
                )}
              </Stack>
            )
          })}

          {hasScope && (
            <CreatePackageHardwareTable
              summary={summary}
              billedHardwareCharges={billedHardwareCharges}
              onToggle={toggleHardwareSelection}
            />
          )}

          {hasScope && summary.optionsAreDue && (
            <SelectableOptionsTable
              summary={summary}
              onToggle={toggleOption}
              backing={purchaseOrderBacking}
            />
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
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography fontWeight={800}>Package preview</Typography>
                  {isMultiPhase && (
                    <Chip
                      size="small"
                      color="warning"
                      icon={<LayersRoundedIcon />}
                      label={`Multi-phase · ${summary.phaseCount} Phases / Buildings`}
                    />
                  )}
                </Stack>
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {summary.phaseSummaries.map((phaseSummary) => (
                    <Box key={phaseSummary.phaseId}>
                      <Typography variant="body2" fontWeight={800}>
                        {formatPhaseBuilding(phaseSummary.phaseCode, phaseSummary.building)}
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
                </Stack>
                <CreatePackageTotals summary={summary} schedule={schedule} />
              </CardContent>
            </Card>
          )}

          {submitError && <Alert severity="error">{submitError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          py: 1.5,
          gap: 1,
          flexWrap: 'wrap',
          borderTop: 1,
          borderColor: 'divider',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
          {canCreate
            ? (
                <>
                  {isMultiPhase ? `${summary.phaseCount} Phases / Buildings · ` : ''}
                  Net amount <strong>{formatCurrency(summary.invoiceAmount)}</strong>
                </>
              )
            : 'Select what to bill to see the net amount.'}
        </Typography>
        <Stack direction="row" spacing={1}>
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
        </Stack>
      </DialogActions>
      {noticeEditorOpen && job && (
        <Suspense
          fallback={(
            <Backdrop open sx={{ zIndex: 'modal' }}>
              <CircularProgress color="inherit" />
            </Backdrop>
          )}
        >
          <PreliminaryNoticeEditorDialog
            job={job}
            onClose={() => setNoticeEditorOpen(false)}
          />
        </Suspense>
      )}
    </Dialog>
  )
}
