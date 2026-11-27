import { InputAdornment } from '@mui/material'

// A number is selected when its field is entered, so typing replaces the 0 it starts with, and
// the mouse wheel does not change it by passing over it.
const selectOnFocus = (event) => event.target.select()
const blurOnWheel = (event) => event.currentTarget.blur()

/** The slots of a number field: its unit after the value and the habits above. */
export default function numberSlots({ min = 0, max = 100, step = 0.01, unit = '%', inputMode = 'decimal' } = {}) {
  return {
    input: unit ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment> } : {},
    htmlInput: { min, max, step, inputMode, onFocus: selectOnFocus, onWheel: blurOnWheel },
  }
}
