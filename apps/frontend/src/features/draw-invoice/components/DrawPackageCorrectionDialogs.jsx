import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
import { canCorrectDrawPackage } from '../services/drawInvoicePackageRecord.js'
import {
  buildUsedDrawSelections,
  drawSelectionKey,
} from '../utils/drawPackages.js'
import { buildDrawWorksheet } from '../utils/drawWorksheet.js'

function cellKey({ lotId, drawIndex }) {
  return `${lotId}:${drawIndex}`
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
  const [selections, setSelections] = useState(record.selections)
  const [periodStart, setPeriodStart] = useState(record.billingPeriodStart ?? '')
  const [periodEnd, setPeriodEnd] = useState(record.billingPeriodEnd ?? '')
  const [notes, setNotes] = useState(record.notes ?? '')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const worksheet = buildDrawWorksheet(job, phase, schedule)
  const occupied = useMemo(
    () => buildUsedDrawSelections(packages, record.id),
    [packages, record.id],
  )
  const selectedKeys = new Set(selections.map(cellKey))
  const originalKeys = new Set(record.selections.map(cellKey))
  const removedCount = record.selections.filter(
    (selection) => !selectedKeys.has(cellKey(selection)),
  ).length
  const addedCount = selections.filter(
    (selection) => !originalKeys.has(cellKey(selection)),
  ).length
  const metadataChanged = periodStart !== (record.billingPeriodStart ?? '')
    || periodEnd !== (record.billingPeriodEnd ?? '')
    || notes.trim() !== (record.notes ?? '')
  const changed = removedCount > 0 || addedCount > 0 || metadataChanged
  const validPeriod = !periodStart || !periodEnd || periodEnd >= periodStart
  const canSave = !submitting && selections.length > 0 && changed
    && validateReason(reason) && validPeriod && notes.trim().length <= 500

  const toggle = (lotId, drawIndex) => {
    const key = `${lotId}:${drawIndex}`
    setSelections((current) => current.some(
      (selection) => cellKey(selection) === key,
    )
      ? current.filter((selection) => cellKey(selection) !== key)
      : [...current, { lotId, drawIndex }])
  }

  const save = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onSave({
        packageId: record.id,
        selections,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
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
      <DialogTitle>Edit {record.packageNumber}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            Keep at least one cell. Yellow cells belong to another Package;
            use “Move cells here” to transfer them. Unchanged cells retain
            their saved prices, while newly added cells are priced using this
            Package’s date ({record.packageDate}). Job, Phase, Billing Setup
            and Package date cannot be edited; cancel and recreate a draft if
            those were selected incorrectly.
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}
          <TableContainer sx={{ maxHeight: 440, border: 1, borderColor: 'divider' }}>
            <Table size="small" stickyHeader aria-label="Edit Package Lot and Draw cells">
              <TableHead>
                <TableRow>
                  <TableCell>Lot</TableCell>
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
                    <TableCell>{row.lotNumber}</TableCell>
                    <TableCell>{row.planCode ?? '—'}</TableCell>
                    {worksheet.draws.map((_, drawIndex) => {
                      const owner = occupied.get(drawSelectionKey(
                        record.jobId, record.phaseId, row.id, drawIndex,
                      ))
                      const selected = selectedKeys.has(`${row.id}:${drawIndex}`)
                      return (
                        <TableCell
                          key={drawIndex}
                          align="center"
                          sx={{ bgcolor: owner ? 'warning.light' : undefined }}
                        >
                          <Checkbox
                            size="small"
                            checked={selected}
                            disabled={Boolean(owner) || submitting}
                            onChange={() => toggle(row.id, drawIndex)}
                            inputProps={{
                              'aria-label': `Lot ${row.lotNumber} Draw ${drawIndex + 1}`,
                            }}
                          />
                          {owner && (
                            <Typography variant="caption" component="div">
                              {owner.packageNumber}
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
          <Typography variant="body2">
            {selections.length} cells after edit · {addedCount} added · {removedCount} removed
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              type="date"
              label="Billing period start"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              type="date"
              label="Billing period end"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              error={!validPeriod}
              helperText={!validPeriod ? 'End cannot precede start.' : ''}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
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
    && String(candidate.phaseId) === String(target.phaseId)
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
              No other editable Package has cells for this Job, Phase and Billing Setup.
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
                    lotId: line.lotId,
                    drawIndex: line.drawIndex,
                  }
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
                          'aria-label': `Move Lot ${line.lotNumber} Draw ${line.drawIndex + 1}`,
                        }}
                      />
                      <Typography variant="body2">
                        Lot {line.lotNumber} · Draw #{line.drawIndex + 1} · {line.planCode}
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
          disabled={submitting || !validateReason(reason)}
        >
          Delete draft
        </Button>
      </DialogActions>
    </Dialog>
  )
}
