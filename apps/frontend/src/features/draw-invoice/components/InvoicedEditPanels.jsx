import {
  Alert,
  Box,
  Checkbox,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import { formatPhaseBuilding } from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import { formatCurrency } from '../utils/drawInvoiceFormatters.js'
import { differenceLimit, formatSignedCurrency } from '../utils/invoiceDifference.js'

const sentWhen = (value) => new Date(value).toLocaleString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const EVENT_LABELS = { EXT: 'Exterior', DM: 'Drywall', HW: 'Hardware' }

/**
 * Shown above the editor when the Package was already emailed to the Builder: the Builder keeps the
 * version it received, so the person is told before changing anything and offered to resend afterwards.
 */
export function SentToBuilderWarning({ submissions }) {
  if (!submissions || submissions.length === 0) return null
  const latest = submissions[0]
  return (
    <Alert severity="warning">
      <strong>The Builder already has this Package.</strong>{' '}
      It was sent{latest.destination ? ` to ${latest.destination}` : ''}
      {latest.sentAt ? ` on ${sentWhen(latest.sentAt)}` : ''}
      {submissions.length > 1 ? ` (and ${submissions.length - 1} time${submissions.length > 2 ? 's' : ''} before)` : ''}.
      The Builder keeps that version: after the invoice is updated, generate the Package again and send it again.
    </Alert>
  )
}

/**
 * Separate Hardware lines and Option units of an invoiced Package. Unchecking one releases it from this
 * Package (it becomes free for another); the invoice total follows. An Option whose Lot has no cell left
 * leaves with the Lot and cannot be kept on its own.
 *
 * Below each list, the ones that are free (no Package bills them) on the Lots of this Package can be put
 * back by checking them; they are priced like new cells, on the date of the Package.
 */
export function InvoicedLinesEditor({
  hardwareLines,
  keptHardwareIds,
  onToggleHardware,
  freeHardware = [],
  addedHardwareIds = new Set(),
  onToggleAddedHardware = () => {},
  optionLines,
  releasedOptionIds,
  keptLotIds,
  onToggleOption,
  freeOptions = [],
  addedOptionIds = new Set(),
  onToggleAddedOption = () => {},
  disabled,
}) {
  if (
    hardwareLines.length === 0 && optionLines.length === 0
    && freeHardware.length === 0 && freeOptions.length === 0
  ) return null

  return (
    <Stack spacing={2}>
      {hardwareLines.length > 0 && (
        <Box>
          <Typography fontWeight={800}>Separate Hardware</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
            Uncheck a line to take it off this Package and the invoice.
          </Typography>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {hardwareLines.map((line) => (
              <Stack
                key={line.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', px: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
              >
                <Checkbox
                  checked={keptHardwareIds.has(line.id)}
                  onChange={() => onToggleHardware(line.id)}
                  disabled={disabled}
                  inputProps={{ 'aria-label': `Keep Hardware ${line.eventType} of Lot ${line.lotNumber}` }}
                />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {formatPhaseBuilding(line.phaseCode, line.building, { separator: ' / ' })} · Lot {line.lotNumber} ·{' '}
                  {EVENT_LABELS[line.eventType] ?? line.eventType}
                </Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(line.grossAmount)}
                </Typography>
              </Stack>
            ))}
          </Box>
        </Box>
      )}

      {freeHardware.length > 0 && (
        <Box data-testid="free-hardware">
          <Typography fontWeight={800}>Separate Hardware you can add</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
            No Package bills these yet. Check one to add it to this Package and the invoice.
          </Typography>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 240, overflow: 'auto' }}>
            {freeHardware.map((line) => (
              <Stack
                key={line.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', px: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
              >
                <Checkbox
                  checked={addedHardwareIds.has(line.id)}
                  onChange={() => onToggleAddedHardware(line.id)}
                  disabled={disabled}
                  inputProps={{ 'aria-label': `Add Hardware ${line.eventType} of Lot ${line.lotNumber}` }}
                />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {formatPhaseBuilding(line.phaseCode, line.building, { separator: ' / ' })} · Lot {line.lotNumber} ·{' '}
                  {EVENT_LABELS[line.eventType] ?? line.eventType}
                </Typography>
              </Stack>
            ))}
          </Box>
        </Box>
      )}

      {optionLines.length > 0 && (
        <Box>
          <Typography fontWeight={800}>Options</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
            Uncheck an Option to release it from this Package. It becomes free to bill on another Package.
          </Typography>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 280, overflow: 'auto' }}>
            {optionLines.map((option) => {
              const leavesWithLot = !keptLotIds.has(String(option.lotId))
              const kept = !leavesWithLot && !releasedOptionIds.has(option.id)
              return (
                <Stack
                  key={option.id}
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: 'center',
                    px: 1.5,
                    borderBottom: 1,
                    borderColor: 'divider',
                    '&:last-child': { borderBottom: 0 },
                    opacity: leavesWithLot ? 0.55 : 1,
                  }}
                >
                  <Checkbox
                    checked={kept}
                    onChange={() => onToggleOption(option.id)}
                    disabled={disabled || leavesWithLot}
                    inputProps={{ 'aria-label': `Keep ${option.optionCode} on Lot ${option.lotNumber}` }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    Lot {option.lotNumber} · {option.optionCode} · {option.description}
                    {option.unitLabel ? ` · ${option.unitLabel}` : ''}
                    {leavesWithLot && (
                      <Typography component="span" variant="body2" color="warning.main">
                        {' '}· leaves with its Lot
                      </Typography>
                    )}
                  </Typography>
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(option.price)}
                  </Typography>
                </Stack>
              )
            })}
          </Box>
        </Box>
      )}

      {freeOptions.length > 0 && (
        <Box data-testid="free-options">
          <Typography fontWeight={800}>Options you can add</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
            Selected on a Lot of this Package and billed by no Package. Check an Option to add it to this Package
            and the invoice; it is priced on the date of the Package.
          </Typography>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 280, overflow: 'auto' }}>
            {freeOptions.map((option) => {
              const unpriced = option.issue === 'PRICE_MISSING'
              return (
                <Stack
                  key={option.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', px: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
                >
                  <Checkbox
                    checked={addedOptionIds.has(option.id)}
                    onChange={() => onToggleAddedOption(option.id)}
                    disabled={disabled || unpriced}
                    inputProps={{ 'aria-label': `Add ${option.optionCode} on Lot ${option.lotNumber}` }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    Lot {option.lotNumber} · {option.optionCode} · {option.description}
                    {option.unitLabel ? ` · ${option.unitLabel}` : ''}
                    {unpriced && (
                      <Typography component="span" variant="body2" color="warning.main">
                        {' '}· has no price yet
                      </Typography>
                    )}
                  </Typography>
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {option.priceNotApplicable ? 'N/A' : unpriced ? '—' : formatCurrency(option.price)}
                  </Typography>
                </Stack>
              )
            })}
          </Box>
        </Box>
      )}
    </Stack>
  )
}

function ChangeList({ title, color, items }) {
  if (items.length === 0) return null
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.25 }}>
        <Chip size="small" variant="outlined" color={color} label={items.length} />
        <Typography variant="body2" fontWeight={750}>{title}</Typography>
      </Stack>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {items.map((item) => (
          <li key={item.key}>
            <Typography variant="body2" color="text.secondary">{item.text}</Typography>
          </li>
        ))}
      </Box>
    </Box>
  )
}

const cellText = (cell) => `Lot ${cell.lot_number} · Draw ${cell.draw_number}`
const hardwareText = (line) => `Lot ${line.lot_number} · ${EVENT_LABELS[line.event_type] ?? line.event_type}`
const optionText = (option) => `Lot ${option.lot_number} · ${option.option_code} · ${option.option_name} · ${formatCurrency(Number(option.option_price))}`

/**
 * What saving would do, from the dry run: the new total of the same invoice, what leaves and what is
 * added, the documents that must be made again, and whether the Builder already received the Package.
 */
export function InvoicedEditReview({ review, difference = null }) {
  const { edit } = review
  const before = Number(edit.previous.net)
  const after = Number(edit.next.net)
  const sent = edit.sent ?? []
  // The invoice keeps a manual line through the edit: the total QuickBooks shows is the Package plus it.
  const extra = difference?.amount ?? 0

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        <strong>Invoice {edit.invoice_number} stays the same invoice in QuickBooks.</strong>{' '}
        Only its lines change, and its total goes from {formatCurrency(before + extra)} to {formatCurrency(after + extra)}
        {' '}({after - before >= 0 ? '+' : '-'}{formatCurrency(Math.abs(after - before))}).
      </Alert>
      {difference && (
        <Alert severity="info" data-testid="difference-kept">
          <strong>
            The invoice keeps its "{difference.description}" line of {formatSignedCurrency(difference.amount)}.
          </strong>{' '}
          For a Package of {formatCurrency(after)} the most a difference may be is {formatCurrency(differenceLimit(after))}.
        </Alert>
      )}
      <SentToBuilderWarning
        submissions={sent.map((entry) => ({ sentAt: entry.sent_at, destination: entry.destination }))}
      />
      <Stack spacing={1.25}>
        <ChangeList
          title="Cells taken off"
          color="error"
          items={edit.removed_cells.map((cell, index) => ({ key: `rc${index}`, text: cellText(cell) }))}
        />
        <ChangeList
          title="Cells added"
          color="success"
          items={edit.added_cells.map((cell, index) => ({ key: `ac${index}`, text: cellText(cell) }))}
        />
        <ChangeList
          title="Options released"
          color="error"
          items={edit.released_options.map((option, index) => ({ key: `ro${index}`, text: optionText(option) }))}
        />
        <ChangeList
          title="Options added"
          color="success"
          items={(edit.added_options ?? []).map((option, index) => ({ key: `ao${index}`, text: optionText(option) }))}
        />
        <ChangeList
          title="Separate Hardware taken off"
          color="error"
          items={edit.removed_hardware.map((line, index) => ({ key: `rh${index}`, text: hardwareText(line) }))}
        />
        <ChangeList
          title="Separate Hardware added"
          color="success"
          items={edit.added_hardware.map((line, index) => ({ key: `ah${index}`, text: hardwareText(line) }))}
        />
      </Stack>
      {edit.removed_documents.length > 0 && (
        <Alert severity="warning">
          <strong>These documents print the old amount, so they will be removed:</strong>{' '}
          {edit.removed_documents.map((document) => document.label || document.document_type).join(', ')}.
          Generate them again from the Package page.
        </Alert>
      )}
    </Stack>
  )
}

/** What the edit did, once QuickBooks has the new lines. */
export function InvoicedEditDone({ result, sent, difference = null }) {
  const edit = result.edit
  return (
    <Stack spacing={2}>
      <Alert severity="success">
        <strong>Invoice {edit?.invoice_number ?? result.docNumber} was updated in QuickBooks.</strong>{' '}
        {edit
          ? `Its total went from ${formatCurrency(Number(edit.previous.net) + (difference?.amount ?? 0))} to ${formatCurrency(Number(result.totalAmount))}.`
          : `Its total is ${formatCurrency(Number(result.totalAmount))}.`}
      </Alert>
      {(result.warnings ?? []).map((warning) => (
        <Alert key={warning} severity="warning">{warning}</Alert>
      ))}
      {edit?.removed_documents?.length > 0 && (
        <Alert severity="warning">
          The Release and Payment Schedule were removed because they print the old amount. Generate them again
          from the Package page.
        </Alert>
      )}
      {sent && (
        <Alert severity="warning">
          The Builder received the previous version of this Package. Generate it again and send it again.
        </Alert>
      )}
    </Stack>
  )
}
