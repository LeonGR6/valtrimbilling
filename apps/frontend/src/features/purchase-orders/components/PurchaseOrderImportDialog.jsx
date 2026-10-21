import { useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded'
import { formatCurrency, formatOptionPrice } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { describeImportAction, summarizeImport } from '../services/purchaseOrderRecord.js'

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Asks before the Purchase Order changes the Job: the options its PDF prints that
 * the system lacks are created in their Plan and selected for the Lot. Nothing is
 * written until the reviewer confirms, and they can leave out any line.
 */
export default function PurchaseOrderImportDialog({
  lines,
  initialSelectedIds,
  importing,
  error,
  onClose,
  onConfirm,
}) {
  const [selected, setSelected] = useState(() => new Set(initialSelectedIds))
  const chosen = lines.filter((line) => selected.has(line.lineId))
  const summary = summarizeImport(chosen)
  const allSelected = chosen.length === lines.length

  const toggle = (lineId) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(lineId)) next.delete(lineId)
    else next.add(lineId)
    return next
  })

  return (
    <Dialog
      open
      fullWidth
      maxWidth="lg"
      onClose={importing ? undefined : onClose}
      aria-labelledby="purchase-order-import-title"
    >
      <DialogTitle id="purchase-order-import-title">
        Add options from the Purchase Order
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info">
            This changes the Job. A new option is created in its Plan with the price the
            PDF prints, and every option is selected for the Lot. A price that differs
            from the PDF is not changed here.
          </Alert>

          <TableContainer>
            <Table size="small" aria-label="Options to add">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={allSelected}
                      indeterminate={chosen.length > 0 && !allSelected}
                      onChange={() => setSelected(
                        allSelected ? new Set() : new Set(lines.map((line) => line.lineId)),
                      )}
                      slotProps={{ input: { 'aria-label': 'Select all options' } }}
                    />
                  </TableCell>
                  <TableCell>Lot</TableCell>
                  <TableCell>Option</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell>What happens</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((line) => {
                  const creates = line.status === 'MISSING_OPTION'
                  return (
                    <TableRow key={line.lineId} hover onClick={() => toggle(line.lineId)} sx={{ cursor: 'pointer' }}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={selected.has(line.lineId)}
                          slotProps={{
                            input: { 'aria-label': `${line.optionCode} for Lot ${line.lotNumber}` },
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{line.lotNumber}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography variant="body2" fontWeight={750}>{line.optionCode}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 320, overflowWrap: 'anywhere' }}>
                        {creates
                          ? (line.descriptionLines[0] ?? '—')
                          : (line.optionName ?? '—')}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {creates
                          ? formatCurrency(line.poUnitPrice)
                          : formatOptionPrice(line.systemPrice, line.systemNotApplicable)}
                        {!creates && line.poUnitPrice !== line.systemPrice && (
                          <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                            PDF: {formatCurrency(line.poUnitPrice)}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{describeImportAction(line)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="body2" color="text.secondary">
            {chosen.length === 0
              ? 'Select at least one option.'
              : `${summary.newOptions > 0 ? `${plural(summary.newOptions, 'new option', 'new options')} will be created. ` : ''}${plural(summary.additions, 'option', 'options')} will be selected for ${chosen.length === 1 ? 'its Lot' : 'their Lots'}.`}
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={importing}>Cancel</Button>
        <Button
          variant="contained"
          disableElevation
          startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <PlaylistAddRoundedIcon />}
          disabled={importing || chosen.length === 0}
          onClick={() => onConfirm(chosen.map((line) => line.lineId))}
        >
          {importing ? 'Adding…' : `Add ${plural(chosen.length, 'option', 'options')}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
