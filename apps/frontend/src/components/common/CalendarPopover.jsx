import { useState } from 'react'
import { Box, Button, ButtonBase, IconButton, Popover, Stack, Typography } from '@mui/material'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { monthGrid, monthOf, monthTitle, shiftMonth, todayIso } from '../../utils/dateInput.js'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function Calendar({ value, onPick, onClear, onClose }) {
  const [shown, setShown] = useState(() => monthOf(value))
  const today = todayIso()
  const title = monthTitle(shown)

  return (
    <Box sx={{ p: 1.5, width: 288 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <IconButton
          size="small"
          aria-label="Previous month"
          onClick={() => setShown((current) => shiftMonth(current, -1))}
        >
          <ChevronLeftRoundedIcon fontSize="small" />
        </IconButton>
        <Typography fontWeight={750} aria-live="polite">{title}</Typography>
        <IconButton
          size="small"
          aria-label="Next month"
          onClick={() => setShown((current) => shiftMonth(current, 1))}
        >
          <ChevronRightRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box
        role="grid"
        aria-label={title}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 0.25 }}
      >
        {WEEKDAYS.map((weekday) => (
          <Typography
            key={weekday}
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: 'center', py: 0.5, fontWeight: 700 }}
          >
            {weekday}
          </Typography>
        ))}
        {monthGrid(shown).flat().map((day) => {
          const selected = day.iso === value
          return (
            <ButtonBase
              key={day.iso}
              role="gridcell"
              aria-selected={selected}
              aria-label={new Date(`${day.iso}T00:00:00Z`).toLocaleDateString('en-US', {
                timeZone: 'UTC',
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              onClick={() => onPick(day.iso)}
              sx={(theme) => ({
                height: 36,
                borderRadius: '50%',
                fontSize: 13.5,
                fontVariantNumeric: 'tabular-nums',
                color: selected
                  ? theme.palette.primary.contrastText
                  : day.inMonth ? 'text.primary' : 'text.disabled',
                bgcolor: selected ? 'primary.main' : 'transparent',
                fontWeight: selected || day.iso === today ? 800 : 400,
                border: day.iso === today && !selected ? 1 : 0,
                borderColor: 'primary.main',
                '&:hover': { bgcolor: selected ? 'primary.dark' : 'action.hover' },
                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' },
              })}
            >
              {day.day}
            </ButtonBase>
          )
        })}
      </Box>

      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1 }}>
        <Button size="small" onClick={() => onPick(today)} sx={{ textTransform: 'none' }}>
          Today
        </Button>
        <Stack direction="row" spacing={0.5}>
          {onClear && (
            <Button size="small" color="inherit" onClick={onClear} sx={{ textTransform: 'none' }}>
              Clear
            </Button>
          )}
          <Button size="small" color="inherit" onClick={onClose} sx={{ textTransform: 'none' }}>
            Close
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}

/**
 * The calendar a date field opens: one month at a time with arrows, today marked and the
 * current date filled in. It is an ordinary Popover, so a click outside it, Escape, the
 * Close button or picking a day always close it (unlike a browser's own date picker, which
 * can stay stuck open inside a modal). `value` is an ISO date.
 */
export default function CalendarPopover({ anchorEl, value, onPick, onClear, onClose }) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { mt: 0.5, borderRadius: 2 } } }}
    >
      {/* Mounted only while open, so it always starts on the month of the date. */}
      <Calendar value={value} onPick={onPick} onClear={onClear} onClose={onClose} />
    </Popover>
  )
}
