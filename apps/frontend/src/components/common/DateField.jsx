import { useState } from 'react'
import { Box, IconButton, InputAdornment, TextField } from '@mui/material'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import CalendarPopover from './CalendarPopover.jsx'
import {
  completeDateText,
  dateTextToIso,
  isoToDateText,
  maskDateInput,
} from '../../utils/dateInput.js'

/**
 * A date that can be typed (05/12/2026) or picked from the calendar button, which opens
 * our own calendar (CalendarPopover) rather than the browser's picker.
 * `value` and `onChange` use ISO dates ("2026-05-12"); `onChange` gets "" while
 * what is typed is empty, incomplete or not a real date, like a native date input.
 */
export default function DateField({
  value,
  onChange,
  error,
  helperText,
  slotProps,
  sx,
  className,
  ...props
}) {
  const [text, setText] = useState(() => isoToDateText(value))
  const [previousValue, setPreviousValue] = useState(value)
  const [touched, setTouched] = useState(false)
  // The button the calendar hangs from while it is open.
  const [pickerAnchor, setPickerAnchor] = useState(null)

  // A date changed from outside (the rule that moves DM and HW after EXT) is
  // shown, unless it is what the person is typing already.
  if (value !== previousValue) {
    setPreviousValue(value)
    if ((value ?? '') !== dateTextToIso(text)) setText(isoToDateText(value))
  }

  const commit = (nextText) => {
    setText(nextText)
    const iso = dateTextToIso(nextText)
    if (iso !== (value ?? '')) onChange(iso)
  }

  const invalid = touched && text.trim() !== '' && dateTextToIso(text) === ''

  const pick = (iso) => {
    commit(isoToDateText(iso))
    setPickerAnchor(null)
  }

  return (
    // The wrapper takes the layout classes and width; the field fills it.
    <Box sx={{ position: 'relative' }} className={className}>
      <TextField
        {...props}
        fullWidth
        sx={sx}
        value={text}
        onChange={(event) => commit(maskDateInput(event.target.value))}
        onBlur={() => {
          setTouched(true)
          const completed = completeDateText(text)
          if (completed !== text) commit(completed)
        }}
        error={Boolean(error) || invalid}
        helperText={invalid ? 'Use the format MM/DD/YYYY.' : helperText}
        placeholder="MM/DD/YYYY"
        slotProps={{
          ...slotProps,
          inputLabel: { shrink: true, ...slotProps?.inputLabel },
          htmlInput: {
            inputMode: 'numeric',
            autoComplete: 'off',
            maxLength: 10,
            ...slotProps?.htmlInput,
          },
          input: {
            ...slotProps?.input,
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  edge="end"
                  size="small"
                  aria-label="Choose date from calendar"
                  aria-haspopup="dialog"
                  aria-expanded={Boolean(pickerAnchor)}
                  onClick={(event) => {
                    const button = event.currentTarget
                    setPickerAnchor((current) => (current ? null : button))
                  }}
                >
                  <CalendarMonthRoundedIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      <CalendarPopover
        anchorEl={pickerAnchor}
        value={value ?? ''}
        onPick={pick}
        onClear={props.required ? undefined : () => pick('')}
        onClose={() => setPickerAnchor(null)}
      />
    </Box>
  )
}
