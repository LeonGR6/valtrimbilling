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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import {
  formatBuilding,
  formatPhase,
} from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import { canCorrectDrawPackage } from '../services/drawInvoicePackageRecord.js'
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
  const phaseModels = shownPhases.map((candidate) => {
    const sheet = buildDrawWorksheet(job, candidate, schedule)
    return {
      phase: candidate,
      worksheet: sheet,
      rowsById: new Map(sheet.rows.map((row) => [String(row.id), row])),
    }
  })
  const occupied = useMemo(
    () => buildUsedDrawSelections(packages, record.id),
    [packages, record.id],
  )
  const billedUtilityCharges = useMemo(
    () => buildBilledUtilityCharges(packages, record.jobId, record.id),
    [packages, record.id, record.jobId],
  )
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

  const toggle = (model, lotId, drawIndex) => {
    const { phase: activePhase, worksheet, rowsById } = model
    const key = `${activePhase.id}:${lotId}:${drawIndex}`
    setSelections((current) => {
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
    })
  }

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
      <DialogTitle>
        <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Edit {record.packageNumber}</span>
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
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
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
                      {formatPhase(sectionPhase.name)} · {formatBuilding(sectionPhase.building)}
                    </Typography>
                  </Stack>
                )}
                <TableContainer sx={{ maxHeight: 440, border: 1, borderColor: 'divider' }}>
                  <Table
                    size="small"
                    stickyHeader
                    aria-label={`Edit Package Lot and Draw cells for ${formatPhase(sectionPhase.name)} ${formatBuilding(sectionPhase.building)}`}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>Lot / Utility</TableCell>
                        <TableCell>Plan</TableCell>
                        {worksheet.draws.map((_, drawIndex) => (
                          <TableCell key={drawIndex} align="center">
                            Draw #{drawIndex + 1}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {worksheet.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.utilityLabel ?? row.lotNumber}</TableCell>
                          <TableCell>{row.planCode ?? '—'}</TableCell>
                          {worksheet.draws.map((_, drawIndex) => {
                            const owner = occupied.get(drawSelectionKey(
                              record.jobId, sectionPhase.id, row.id, drawIndex,
                            ))
                            const utilityOwner = row.isUtilityBuilding
                              ? billedUtilityCharges.get(utilityChargeKey(
                                  row.id,
                                  getUtilityBillingMode(schedule),
                                  worksheet.draws[drawIndex]?.eventType,
                                ))
                              : null
                            const selected = selectedKeys.has(
                              `${sectionPhase.id}:${row.id}:${drawIndex}`,
                            )
                            const utilityAllocationUnavailable = row.isUtilityBuilding
                              && getUtilityBillingMode(schedule) === 'BY_EVENT'
                              && getUtilityEventPercentage(
                                schedule,
                                worksheet.draws[drawIndex]?.eventType,
                              ) <= 0
                            return (
                              <TableCell
                                key={drawIndex}
                                align="center"
                                sx={{ bgcolor: owner || utilityOwner ? 'warning.light' : undefined }}
                              >
                                <Checkbox
                                  size="small"
                                  checked={selected}
                                  disabled={Boolean(owner || utilityOwner)
                                    || utilityAllocationUnavailable
                                    || submitting}
                                  onChange={() => toggle(model, row.id, drawIndex)}
                                  inputProps={{
                                    'aria-label': `${row.utilityLabel ?? `Lot ${row.lotNumber}`} Draw ${drawIndex + 1}`,
                                  }}
                                />
                                {owner && (
                                  <Typography variant="caption" component="div">
                                    {owner.packageNumber}
                                  </Typography>
                                )}
                                {!owner && utilityOwner && (
                                  <Typography variant="caption" component="div">
                                    {utilityOwner.packageNumber}
                                  </Typography>
                                )}
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            )
          })}

          <Typography variant="body2">
            {selections.length} cells after edit · {addedCount} added · {removedCount} removed
          </Typography>
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
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Back</Button>
        <Button variant="contained" onClick={save} disabled={!canSave}>
          Save correction
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
                        Phase {line.phaseCode} / Building {line.building} ·{' '}
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
