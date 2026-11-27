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
  FormControlLabel,
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
import PriceCheckRoundedIcon from '@mui/icons-material/PriceCheckRounded'
import { formatCurrency, formatOptionPrice } from '../../draw-invoice/utils/drawInvoiceFormatters.js'

const REASON_MAX = 500

/**
 * Offers the price a Purchase Order prints for an option. It is only a suggestion:
 * nothing changes until the reviewer chooses the Lots and confirms, with a reason.
 * The option's price in its Plan becomes the PDF's price, and the chosen Lots move
 * to it. Lots of the Plan that are not chosen keep the price they bill.
 */
export default function PurchaseOrderPriceDialog({
  line,
  candidates,
  adopting,
  error,
  needsDocumentsConfirmation,
  onClose,
  onConfirm,
}) {
  const [selected, setSelected] = useState(() => new Set([line.lineId]))
  const [reason, setReason] = useState(`Purchase Order ${line.workOrderNo}`)
  const [removeDocuments, setRemoveDocuments] = useState(false)
  const chosen = candidates.filter((candidate) => selected.has(candidate.lineId))
  const conflicting = candidates.some((candidate) => candidate.conflictingPoPrices)
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= REASON_MAX
  const canConfirm = chosen.length > 0 && reasonValid && !adopting
    && (!needsDocumentsConfirmation || removeDocuments)

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
      maxWidth="md"
      onClose={adopting ? undefined : onClose}
      aria-labelledby="purchase-order-price-title"
    >
      <DialogTitle id="purchase-order-price-title">
        Use the price of the Purchase Order
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography>
            <strong>{line.optionCode}</strong>
            {line.optionName ? ` · ${line.optionName}` : ''} in Plan {line.planCode}:
            {' '}the PDF prints <strong>{formatCurrency(line.poUnitPrice)}</strong>.
          </Typography>

          <Alert severity="info">
            An option has one price per Plan. Confirming changes that price to{' '}
            {formatCurrency(line.poUnitPrice)} for every Phase created from now on, and
            moves the Lots you choose below to it. Lots you leave out keep the price they
            bill. Draft Packages that bill the option are calculated again; Packages
            already issued keep their amount and the difference is recorded as pending.
          </Alert>

          {conflicting && (
            <Alert severity="warning">
              Purchase Orders of other Lots of this Plan print a different price for this
              option. Check which one is right before changing the Plan&apos;s price.
            </Alert>
          )}

          <TableContainer>
            <Table size="small" aria-label="Lots that can take the price">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Lot</TableCell>
                  <TableCell>Work order</TableCell>
                  <TableCell align="right">Bills now</TableCell>
                  <TableCell align="right">PDF</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {candidates.map((candidate) => (
                  <TableRow
                    key={candidate.lineId}
                    hover
                    onClick={() => toggle(candidate.lineId)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selected.has(candidate.lineId)}
                        slotProps={{
                          input: { 'aria-label': `Lot ${candidate.lotNumber}` },
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      Lot {candidate.lotNumber}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' · '}Phase {candidate.phaseCode}
                      </Typography>
                    </TableCell>
                    <TableCell>{candidate.workOrderNo}</TableCell>
                    <TableCell align="right">
                      {formatOptionPrice(candidate.systemPrice, candidate.systemNotApplicable)}
                    </TableCell>
                    <TableCell align="right">{formatCurrency(candidate.poUnitPrice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {candidates.length > 1 && (
            <Typography variant="caption" color="text.secondary">
              Other Lots of this Plan whose Purchase Order prints the same price are listed
              too. Only the ones you tick change.
            </Typography>
          )}

          <TextField
            label="Reason for the change"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            multiline
            minRows={1}
            error={!reasonValid}
            helperText={reasonValid
              ? 'It is kept with the price update.'
              : 'Enter 3 to 500 characters.'}
            slotProps={{ htmlInput: { maxLength: REASON_MAX } }}
          />

          {needsDocumentsConfirmation && (
            <Alert severity="warning">
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={removeDocuments}
                    onChange={(event) => setRemoveDocuments(event.target.checked)}
                  />
                )}
                label="Remove the generated Release and Payment Schedule of those Draft Packages. They no longer match the new price and have to be generated again."
              />
            </Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={adopting}>Cancel</Button>
        <Button
          variant="contained"
          disableElevation
          startIcon={adopting ? <CircularProgress size={16} color="inherit" /> : <PriceCheckRoundedIcon />}
          disabled={!canConfirm}
          onClick={() => onConfirm({
            lineIds: chosen.map((candidate) => candidate.lineId),
            reason,
            removeDocuments,
          })}
        >
          {adopting
            ? 'Changing…'
            : `Use ${formatCurrency(line.poUnitPrice)} for ${chosen.length} ${chosen.length === 1 ? 'Lot' : 'Lots'}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
