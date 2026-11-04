import { Autocomplete, Chip, TextField, Tooltip } from '@mui/material'
import {
  addLotRanges,
  LOT_RANGE_HELP,
  lotNumbersOfRanges,
  splitTypedLots,
} from '../utils/lotRange.js'

const MAX_LOTS_IN_TOOLTIP = 24

function describeLots(lotNumbers) {
  if (lotNumbers.length === 1) return `Lot ${lotNumbers[0]}`
  const shown = lotNumbers.slice(0, MAX_LOTS_IN_TOOLTIP).join(', ')
  return lotNumbers.length > MAX_LOTS_IN_TOOLTIP
    ? `${lotNumbers.length} lots: ${shown}, …`
    : `${lotNumbers.length} lots: ${shown}`
}

/**
 * The box where Lots are typed to add them to a Phase. A Lot (12, 12.1) or a range (1-5, or 14-10
 * to go down) becomes a chip when Enter, Space, a comma or a semicolon ends it, like the email
 * addresses of the Sequence Sheet email. Enter in an empty box adds the chips to the Phase.
 *
 * What is typed and the chips belong to the parent, which adds them to the Phase, so a range
 * typed and not yet closed is not lost when the person goes straight to the button.
 */
export default function LotRangeField({
  ranges,
  onRangesChange,
  typed,
  onTypedChange,
  error,
  onErrorChange,
  getContext,
  onSubmit,
  sx,
}) {
  const lotCount = lotNumbersOfRanges(ranges).length

  const commit = (values) => {
    const result = addLotRanges(ranges, values, getContext())
    onRangesChange(result.ranges)
    onErrorChange(result.error)
    return result
  }

  const handleInput = (text) => {
    const { done, rest } = splitTypedLots(text)
    if (done === '') {
      onTypedChange(text.trim() === '' ? '' : rest)
      if (error) onErrorChange('')
      return
    }
    // What the separators ended leaves the box: it is a chip now, or the message says why it is not.
    commit([done])
    onTypedChange(rest)
  }

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter') return
    // The box is inside the Phase form: Enter ends a chip or adds the chips, and never saves the Phase.
    event.preventDefault()
    event.defaultMuiPrevented = true
    if (typed.trim() !== '') {
      commit([typed])
      onTypedChange('')
    } else if (ranges.length > 0) {
      onSubmit()
    }
  }

  return (
    <Autocomplete
      multiple
      freeSolo
      options={[]}
      value={ranges.map(({ token }) => token)}
      inputValue={typed}
      sx={sx}
      onKeyDown={handleKeyDown}
      onChange={(_, values, reason) => {
        if (reason === 'removeOption' || reason === 'clear') {
          onRangesChange(ranges.filter(({ token }) => values.includes(token)))
          onErrorChange('')
        }
      }}
      onInputChange={(_, text, reason) => {
        if (reason === 'input') handleInput(text)
      }}
      renderValue={(tokens, getItemProps) => tokens.map((token, index) => {
        const { key, ...itemProps } = getItemProps({ index })
        const range = ranges.find((candidate) => candidate.token === token)
        return (
          <Tooltip key={key} title={range ? describeLots(range.lotNumbers) : ''}>
            <Chip size="small" variant="outlined" label={token} {...itemProps} />
          </Tooltip>
        )
      })}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Lots"
          placeholder={ranges.length === 0 ? 'Example: 1-5  12  12.1  14-10' : 'Add another'}
          error={Boolean(error)}
          helperText={
            error
            || (lotCount > 0
              ? `${lotCount} ${lotCount === 1 ? 'lot' : 'lots'} ready. Press Enter again, or Add lots, to add them.`
              : `${LOT_RANGE_HELP} Press Enter or Space after each one.`)
          }
        />
      )}
    />
  )
}
