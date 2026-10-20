import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import { formatPhaseBuilding } from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import { canCorrectDrawPackage } from '../services/drawInvoicePackageRecord.js'
import { buildDrawCalendarHeadings } from '../utils/calendarDrawSuggestions.js'
import DrawSelectionGrid from './dialogs/DrawSelectionGrid.jsx'
import { usePackageReleases } from '../hooks/usePackageReleases.js'
import PackageReleasesNotice from './PackageReleasesNotice.jsx'
import {
  buildBilledHardwareCharges,
  buildBilledUtilityCharges,
  buildUsedDrawSelections,
  drawSelectionKey,
  hardwareChargeKey,
  utilityChargeKey,
} from '../utils/drawPackages.js'
import {
  buildDrawWorksheet,
  getHardwareBillingMode,
  getHardwareEventPercentage,
  getUtilityBillingMode,
  getUtilityEventPercentage,
} from '../utils/drawWorksheet.js'
import { isMultiPhasePackage, phaseScopeLabel } from '../utils/packagePhaseScope.js'

const NO_KEYS = new Set()

function cellKey({ phaseId, lotId, drawIndex }) {
  return `${phaseId}:${lotId}:${drawIndex}`
}

function validateReason(reason) {
  return reason.trim().length > 0 && reason.trim().length <= 500
}

export function EditDrawPackageDialog({
  record,
  job,
  phase,
  schedule,
  packages,
  productionActivities = [],
  onClose,
  onSave,
}) {
  const releases = usePackageReleases(record.id)
  const availablePhases = job.sequenceSheet?.phases ?? []
  // Every Phase the Package already covers is shown, plus any the user adds.
  // A Phase that has cells stays on screen: its cells are removed by unchecking
  // them, never by hiding the Phase.
  const [shownPhaseIds, setShownPhaseIds] = useState(() => {
    const ids = new Set([
      ...record.selections.map(({ phaseId }) => String(phaseId)),
      ...(record.selections.length === 0 && phase?.id != null ? [String(phase.id)] : []),
    ])
    return availablePhases.map(({ id }) => String(id)).filter((id) => ids.has(id))
  })
  const [selections, setSelections] = useState(record.selections)
  const [notes, setNotes] = useState(record.notes ?? '')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const shownPhaseIdSet = new Set(shownPhaseIds)
  const shownPhases = availablePhases.filter(
    (candidate) => shownPhaseIdSet.has(String(candidate.id)),
  )
  const occupied = useMemo(
    () => buildUsedDrawSelections(packages, record.id),
    [packages, record.id],
  )
  const billedUtilityCharges = useMemo(
    () => buildBilledUtilityCharges(packages, record.jobId, record.id),
    [packages, record.id, record.jobId],
  )
  const phaseModels = shownPhases.map((candidate) => {
    const sheet = buildDrawWorksheet(job, candidate, schedule)
    // Cells another Package holds, plus Utility charges it already billed, so
    // the grid can lock both the same way.
    const lockedCells = new Map(occupied)
    for (const row of sheet.rows.filter((item) => item.isUtilityBuilding)) {
      sheet.draws.forEach((draw, drawIndex) => {
        const utilityOwner = billedUtilityCharges.get(utilityChargeKey(
          row.id,
          getUtilityBillingMode(schedule),
          draw.eventType,
        ))
        if (utilityOwner) {
          lockedCells.set(
            drawSelectionKey(record.jobId, candidate.id, row.id, drawIndex),
            utilityOwner,
          )
        }
      })
    }
    const calendarHeadings = buildDrawCalendarHeadings({
      activities: productionActivities,
      job,
      phase: candidate,
      schedule,
    })

    return {
      phase: candidate,
      worksheet: sheet,
      rowsById: new Map(sheet.rows.map((row) => [String(row.id), row])),
      lockedCells,
      headings: sheet.draws.map((draw, drawIndex) => (
        calendarHeadings[drawIndex]?.eventType
          ? calendarHeadings[drawIndex]
          : { eventType: draw.eventType ?? null, eventDates: [] }
      )),
    }
  })
  const billedHardwareCharges = useMemo(
    () => buildBilledHardwareCharges(packages, record.jobId, record.id),
    [packages, record.id, record.jobId],
  )
  const selectedKeys = new Set(selections.map(cellKey))
  const originalKeys = new Set(record.selections.map(cellKey))
  const removedCount = record.selections.filter(
    (selection) => !selectedKeys.has(cellKey(selection)),
  ).length
  const addedCount = selections.filter(
    (selection) => !originalKeys.has(cellKey(selection)),
  ).length
  const metadataChanged = notes.trim() !== (record.notes ?? '')
  const changed = removedCount > 0 || addedCount > 0 || metadataChanged
  const canSave = !submitting && !releases.loading && releases.releases.length === 0
    && selections.length > 0 && changed
    && validateReason(reason) && notes.trim().length <= 500
  const packagePhaseIds = new Set(selections.map(({ phaseId }) => String(phaseId)))
  const packagePhases = availablePhases.filter(
    (candidate) => packagePhaseIds.has(String(candidate.id)),
  )
  const isMultiPhase = isMultiPhasePackage(packagePhases.length)

  const toggleCell = (current, model, lotId, drawIndex) => {
    const { phase: activePhase, worksheet, rowsById } = model
    const key = `${activePhase.id}:${lotId}:${drawIndex}`
    const isSelected = current.some(
      (selection) => cellKey(selection) === key,
    )
    if (isSelected) {
      return current.filter((selection) => cellKey(selection) !== key)
    }

    const utilityBillingMode = getUtilityBillingMode(schedule)
    const selectedEventType = worksheet.draws[drawIndex]?.eventType
    const withoutCurrentUtilityRow = rowsById.get(String(lotId))?.isUtilityBuilding
      ? current.filter((selection) => {
          const sameUtilityRow = String(selection.phaseId) === String(activePhase.id)
            && String(selection.lotId) === String(lotId)
          if (!sameUtilityRow) return true
          if (utilityBillingMode === 'FULL') return false
          return worksheet.draws[selection.drawIndex]?.eventType
            !== selectedEventType
        })
      : current
    const hardwareBillingMode = getHardwareBillingMode(schedule)
    const hardwareEventType = worksheet.draws[drawIndex]?.eventType
    const hardwareKey = hardwareChargeKey(
      lotId,
      hardwareBillingMode,
      hardwareEventType,
    )
    const hardwareAlreadySelected = current.some((selection) => (
      String(selection.lotId) === String(lotId)
      && selection.chargeHardware
      && hardwareChargeKey(
        lotId,
        hardwareBillingMode,
        worksheet.draws[selection.drawIndex]?.eventType,
      ) === hardwareKey
    ))
    const chargeHardware = !rowsById.get(String(lotId))?.isUtilityBuilding
      && hardwareBillingMode === 'BY_EVENT'
      && getHardwareEventPercentage(schedule, hardwareEventType) > 0
      && !billedHardwareCharges.has(hardwareKey)
      && !hardwareAlreadySelected
    return [
      ...withoutCurrentUtilityRow,
      record.selections.find((selection) => cellKey(selection) === key)
        ?? { phaseId: activePhase.id, lotId, drawIndex, chargeHardware },
    ]
  }

  const toggle = (model, lotId, drawIndex) => {
    setSelections((current) => toggleCell(current, model, lotId, drawIndex))
  }

  // "Select all" for a Lot or a Draw: selects the missing cells, or clears the
  // group when it is already complete.
  const toggleGroup = (model, cells) => {
    setSelections((current) => {
      const selectedNow = new Set(current.map(cellKey))
      const keyOf = ({ lotId, drawIndex }) => `${model.phase.id}:${lotId}:${drawIndex}`
      const allSelected = cells.length > 0
        && cells.every((cell) => selectedNow.has(keyOf(cell)))

      return cells.reduce((next, cell) => {
        const isSelected = next.some((selection) => cellKey(selection) === keyOf(cell))
        return isSelected === allSelected
          ? toggleCell(next, model, cell.lotId, cell.drawIndex)
          : next
      }, current)
    })
  }

  const cellIsLocked = (model, lotId, drawIndex) => model.lockedCells.has(
    drawSelectionKey(record.jobId, model.phase.id, lotId, drawIndex),
  )

  const cellIsUnavailable = (model, row, drawIndex) => submitting || (
    row.isUtilityBuilding
    && getUtilityBillingMode(schedule) === 'BY_EVENT'
    && getUtilityEventPercentage(
      schedule,
      model.worksheet.draws[drawIndex]?.eventType,
    ) <= 0
  )

  const save = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onSave({
        packageId: record.id,
        selections,
        notes,
        reason,
      })
      onClose()
    } catch (saveError) {
      setError(saveError.message)
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6" component="div" fontWeight={800}>
            Edit {record.packageNumber}
          </Typography>
          {isMultiPhase && (
            <Chip
              size="small"
              color="warning"
              icon={<LayersRoundedIcon />}
              label={`Multi-phase · ${packagePhases.length} Phases / Buildings`}
              sx={{ fontWeight: 750 }}
            />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Correct the Lot / Draw cells of this draft Package. The reason is kept
          in its correction history.
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.5}>
          <Alert severity="info">
            Keep at least one cell. Yellow cells belong to another Package;
            use “Move cells here” to transfer them. Unchanged cells retain
            their saved prices, while newly added cells are priced using this
            Package’s date ({record.packageDate}). You may add cells from any
            Phase in this Job. Job, Billing Setup and Package date cannot be edited.
          </Alert>
          <PackageReleasesNotice state={releases} action="edit this draft" />
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography fontWeight={800}>Phases / Buildings in this Package</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              Add another Phase / Building to take cells from it. Each one appears
              below, and they are all billed together in one invoice.
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {availablePhases.map((candidate) => {
                const id = String(candidate.id)
                const shown = shownPhaseIdSet.has(id)
                const cellCount = selections.filter(
                  (selection) => String(selection.phaseId) === id,
                ).length
                const lots = (candidate.lots ?? []).filter((row) => !row.isUtilityBuilding).length
                const utility = (candidate.lots ?? []).length - lots

                return (
                  <Chip
                    key={candidate.id}
                    clickable
                    color={shown ? 'primary' : 'default'}
                    variant={shown ? 'filled' : 'outlined'}
                    icon={shown ? <CheckRoundedIcon /> : <AddRoundedIcon />}
                    disabled={submitting || (shown && cellCount > 0)}
                    onClick={() => setShownPhaseIds((current) => (shown
                      ? current.filter((value) => value !== id)
                      : [...current, id]))}
                    title={shown && cellCount > 0
                      ? 'This Phase has cells in the Package. Uncheck its cells to take it out.'
                      : shown
                        ? 'Hide this Phase'
                        : 'Add this Phase to the edit'}
                    label={[
                      phaseScopeLabel(candidate.name, candidate.building).replace(' / ', ' · '),
                      `${lots} lots`,
                      utility > 0 ? `${utility} Utility` : null,
                      cellCount > 0 ? `${cellCount} ${cellCount === 1 ? 'cell' : 'cells'}` : null,
                    ].filter(Boolean).join(' · ')}
                  />
                )
              })}
            </Stack>
          </Box>

          {isMultiPhase && (
            <Alert severity="warning" icon={<LayersRoundedIcon />}>
              <strong>Multi-phase Package.</strong> This Package bills{' '}
              {packagePhases.length} Phases / Buildings together on one invoice:{' '}
              {packagePhases.map((candidate) => (
                phaseScopeLabel(candidate.name, candidate.building)
              )).join(' · ')}.
            </Alert>
          )}

          {phaseModels.length === 0 && (
            <Alert severity="info">
              Select a Phase / Building to see its Lots and Draws.
            </Alert>
          )}

          {phaseModels.map((model, index) => {
            const { phase: sectionPhase, worksheet } = model

            return (
              <Stack
                key={sectionPhase.id}
                spacing={1}
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
                      {formatPhaseBuilding(sectionPhase.name, sectionPhase.building)}
                    </Typography>
                  </Stack>
                )}
                <DrawSelectionGrid
                  job={job}
                  phase={sectionPhase}
                  worksheet={worksheet}
                  drawCalendarHeadings={model.headings}
                  usedSelections={model.lockedCells}
                  selectedSelections={selections.filter(
                    (selection) => String(selection.phaseId) === String(sectionPhase.id),
                  )}
                  selectionIsUsed={(lotId, drawIndex) => cellIsLocked(model, lotId, drawIndex)}
                  selectionIsSelected={(lotId, drawIndex) => (
                    selectedKeys.has(`${sectionPhase.id}:${lotId}:${drawIndex}`)
                  )}
                  calendarReadySelectionKeys={NO_KEYS}
                  suggestedSelectionKeys={NO_KEYS}
                  toggleSelection={(lotId, drawIndex) => toggle(model, lotId, drawIndex)}
                  toggleLotSelections={(lotId) => toggleGroup(
                    model,
                    worksheet.draws
                      .map((_, drawIndex) => ({ lotId, drawIndex }))
                      .filter(({ drawIndex }) => !cellIsLocked(model, lotId, drawIndex)
                        && !cellIsUnavailable(model, model.rowsById.get(String(lotId)), drawIndex)),
                  )}
                  toggleDrawSelections={(drawIndex) => toggleGroup(
                    model,
                    worksheet.rows
                      .filter((row) => !row.isUtilityBuilding)
                      .map((row) => ({ lotId: row.id, drawIndex }))
                      .filter(({ lotId }) => !cellIsLocked(model, lotId, drawIndex)
                        && !cellIsUnavailable(model, model.rowsById.get(String(lotId)), drawIndex)),
                  )}
                  cellDisabled={(row, drawIndex) => cellIsUnavailable(model, row, drawIndex)}
                  rowAllowsGroupSelection={(row) => !row.isUtilityBuilding}
                />
              </Stack>
            )
          })}

          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip
              size="small"
              color="primary"
              variant={selections.length > 0 ? 'filled' : 'outlined'}
              label={`${selections.length} ${selections.length === 1 ? 'cell' : 'cells'} after edit`}
            />
            <Chip
              size="small"
              color={addedCount > 0 ? 'success' : 'default'}
              variant="outlined"
              label={`${addedCount} added`}
            />
            <Chip
              size="small"
              color={removedCount > 0 ? 'error' : 'default'}
              variant="outlined"
              label={`${removedCount} removed`}
            />
          </Stack>
          <TextField
            label="Package notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
            error={notes.trim().length > 500}
            helperText={`${notes.trim().length}/500`}
          />
          <TextField
            label="Reason for correction"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            error={reason.trim().length > 500}
            helperText="Saved in the Package correction history."
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" disableElevation onClick={save} disabled={!canSave}>
          {submitting ? 'Saving…' : 'Save correction'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function TransferDrawPackageCellsDialog({
  target,
  packages,
  onClose,
  onTransfer,
}) {
  const sources = packages.filter((candidate) => candidate.id !== target.id
    && String(candidate.jobId) === String(target.jobId)
    && String(candidate.setupVersionId) === String(target.setupVersionId)
    && canCorrectDrawPackage(candidate)
    && candidate.selections.length > 0)
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [selections, setSelections] = useState([])
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const source = sources.find((candidate) => String(candidate.id) === String(sourceId))
  const selectedKeys = new Set(selections.map(cellKey))

  const toggle = (selection) => {
    const key = cellKey(selection)
    setSelections((current) => current.some((item) => cellKey(item) === key)
      ? current.filter((item) => cellKey(item) !== key)
      : [...current, selection])
  }

  const transfer = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onTransfer({
        toPackageId: target.id,
        fromPackageId: source.id,
        selections,
        reason,
      })
      onClose()
    } catch (transferError) {
      setError(transferError.message)
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Move cells to {target.packageNumber}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            The selected Lot / Draw cells leave the source and are calculated
            again using {target.packageNumber}’s date ({target.packageDate}).
            If the source becomes empty, it is cancelled automatically.
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}
          {sources.length === 0 ? (
            <Alert severity="warning">
              No other editable Package has cells for this Job and Billing Setup.
            </Alert>
          ) : (
            <>
              <TextField
                select
                label="Move from Package"
                value={sourceId}
                onChange={(event) => {
                  setSourceId(event.target.value)
                  setSelections([])
                }}
              >
                {sources.map((candidate) => (
                  <MenuItem key={candidate.id} value={candidate.id}>
                    {candidate.packageNumber} · {candidate.selections.length} cells
                  </MenuItem>
                ))}
              </TextField>
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                {source?.persistedDrawLines.map((line) => {
                  const selection = {
                    phaseId: line.phaseId,
                    lotId: line.lotId,
                    drawIndex: line.drawIndex,
                    chargeHardware: Number(line.hardwarePercentage) > 0
                      || Number(line.hardwareAmount) > 0,
                  }
                  const rowLabel = line.isUtilityBuilding
                    ? line.utilityLabel
                    : `Lot ${line.lotNumber}`
                  return (
                    <Stack
                      key={cellKey(selection)}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', px: 1.5, borderBottom: 1, borderColor: 'divider' }}
                    >
                      <Checkbox
                        checked={selectedKeys.has(cellKey(selection))}
                        onChange={() => toggle(selection)}
                        disabled={submitting}
                        inputProps={{
                          'aria-label': `Move ${rowLabel} Draw ${line.drawIndex + 1}`,
                        }}
                      />
                      <Typography variant="body2">
                        {formatPhaseBuilding(line.phaseCode, line.building, { separator: ' / ' })} ·{' '}
                        {rowLabel} · Draw #{line.drawIndex + 1} · {line.planCode}
                      </Typography>
                    </Stack>
                  )
                })}
              </Box>
              <Typography variant="body2">{selections.length} cells selected</Typography>
              <TextField
                label="Reason for transfer"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                error={reason.trim().length > 500}
                helperText="Saved with the source and destination Package IDs."
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Back</Button>
        <Button
          variant="contained"
          onClick={transfer}
          disabled={submitting || !source || selections.length === 0
            || !validateReason(reason)}
        >
          Move selected cells
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function CancelDrawPackageDialog({ record, onClose, onCancel }) {
  const releases = usePackageReleases(record.id)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const cancel = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onCancel(record.id, reason)
      onClose()
    } catch (cancelError) {
      setError(cancelError.message)
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Delete draft {record.packageNumber}?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            This removes the draft from the active Packages table, releases
            {record.selections.length} Lot / Draw cells and sets its invoice
            total to zero. Its Package number and correction history remain
            in the audit trail. This cannot be undone on the same Package.
          </Alert>
          <PackageReleasesNotice state={releases} action="delete this draft" />
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Reason for deletion"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            multiline
            minRows={2}
            error={reason.trim().length > 500}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Keep draft</Button>
        <Button
          color="error"
          variant="contained"
          onClick={cancel}
          disabled={submitting || releases.loading || releases.releases.length > 0
            || !validateReason(reason)}
        >
          Delete draft
        </Button>
      </DialogActions>
    </Dialog>
  )
}
