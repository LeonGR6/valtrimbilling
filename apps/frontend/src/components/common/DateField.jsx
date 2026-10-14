import { useRef, useState } from 'react'
import { Box, IconButton, InputAdornment, TextField } from '@mui/material'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import {
  completeDateText,
  dateTextToIso,
  isoToDateText,
  maskDateInput,
} from '../../utils/dateInput.js'

/**
 * A date that can be typed (05/12/2026) or picked from the calendar button.
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
  const pickerRef = useRef(null)

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

  const openPicker = () => {
    const picker = pickerRef.current
    if (!picker) return
    if (typeof picker.showPicker === 'function') picker.showPicker()
    else picker.click()
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
                  onClick={openPicker}
                >
                  <CalendarMonthRoundedIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      {/* The browser's own calendar, opened by the button above. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? ''}
        onChange={(event) => commit(isoToDateText(event.target.value))}
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 0,
          padding: 0,
          border: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </Box>
  )
}
