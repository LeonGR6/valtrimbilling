import { Box, InputAdornment, TextField, Typography } from '@mui/material'
import {
  cellKey,
  cleanPastedPrice,
  editableText,
  effectivePlanPrice,
  isPriced,
} from '../utils/priceWorksheet.js'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

function previousText(kind, item) {
  if (kind === 'option') {
    if (item.priceNotApplicable) return 'NA'
    return isPriced(item.price) ? currencyFormatter.format(item.price) : 'not priced'
  }
  const price = kind === 'hardware' ? item.hardwarePrice : item.price
  return isPriced(price) ? currencyFormatter.format(price) : 'not priced'
}

// Plan and Option prices share the "Price" column, so moving down it goes from a
// Plan to its Options and on to the next Plan, as in a spreadsheet.
function columnOf(input) {
  const root = input.closest('[data-price-sheet]') ?? document
  return [...root.querySelectorAll(`input[data-price-column="${input.dataset.priceColumn}"]`)]
    .filter((element) => !element.disabled && element.offsetParent !== null)
}

function moveFocus(input, step) {
  const column = columnOf(input)
  const target = column[column.indexOf(input) + step]
  if (!target) return false

  target.focus()
  target.select()
  return true
}

/**
 * One price of the sheet while it is being edited. Enter and the arrow keys move
 * through the column, a column copied from a spreadsheet can be pasted, and a
 * changed price says what it was.
 *
 * kind: 'plan' (item is the Plan), 'hardware' (item is the Plan) or 'option'.
 */
export default function WorksheetPriceField({ worksheet, kind, item, plan, label }) {
  const key = kind === 'option'
    ? cellKey.option(item.id)
    : kind === 'hardware' ? cellKey.hardware(item.id) : cellKey.plan(item.id)
  const { drafts, evaluation } = worksheet
  const value = drafts.has(key) ? drafts.get(key) : editableText(kind, item)
  const error = evaluation.errors.get(key)
  const changed = evaluation.changedKeys.has(key)
  const waitsForPlanPrice = kind === 'hardware'
    && !isPriced(effectivePlanPrice(plan ?? item, drafts))

  const handleKeyDown = (event) => {
    const step = event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey)
      ? -1
      : event.key === 'ArrowDown' || event.key === 'Enter' ? 1 : 0
    if (step === 0) return

    event.preventDefault()
    moveFocus(event.currentTarget, step)
  }

  const handlePaste = (event) => {
    const text = event.clipboardData?.getData('text')
    if (!text) return

    event.preventDefault()
    const input = event.currentTarget
    const values = text.replace(/\r?\n$/, '').split(/\r?\n/).map((row) => cleanPastedPrice(row.split('\t')[0]))
    const column = columnOf(input)
    const start = column.indexOf(input)
    worksheet.setMany(values.flatMap((pasted, index) => {
      const target = column[start + index]
      return target ? [[target.dataset.priceKey, pasted]] : []
    }))
  }

  return (
    <Box sx={{ minWidth: 0 }}>
      <TextField
        value={value}
        onChange={(event) => worksheet.setDraft(key, event.target.value)}
        onFocus={(event) => event.target.select()}
        placeholder={kind === 'option' ? '0.00 or NA' : '0.00'}
        error={Boolean(error)}
        disabled={waitsForPlanPrice}
        size="small"
        fullWidth
        slotProps={{
          input: {
            startAdornment: <InputAdornment position="start">$</InputAdornment>,
            sx: {
              bgcolor: changed ? 'primary.light' : undefined,
              '& input': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
            },
          },
          htmlInput: {
            'aria-label': label,
            'aria-invalid': Boolean(error),
            'data-price-key': key,
            'data-price-column': kind === 'hardware' ? 'hardware' : 'price',
            inputMode: kind === 'option' ? 'text' : 'decimal',
            autoComplete: 'off',
            // On the input itself: a TextField would bind them to its wrapper.
            onKeyDown: handleKeyDown,
            onPaste: handlePaste,
          },
        }}
      />
      {error ? (
        <Typography variant="caption" color="error" component="div" role="alert">{error}</Typography>
      ) : changed ? (
        <Typography variant="caption" color="text.secondary" component="div">
          was {previousText(kind, item)}
        </Typography>
      ) : waitsForPlanPrice ? (
        <Typography variant="caption" color="text.secondary" component="div">
          Set the Plan price first
        </Typography>
      ) : null}
    </Box>
  )
}
