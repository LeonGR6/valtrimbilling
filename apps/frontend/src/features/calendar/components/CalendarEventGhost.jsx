import { Box } from '@mui/material'

/**
 * A stand-in for an event that is still loading: grey bars where its text will be, sized like the
 * event of that view (a slim pill in Month, a small card in Week and List). It says nothing to
 * screen readers and cannot be clicked.
 */
export default function CalendarEventGhost({ width, isMonth = false, isList = false }) {
  if (isMonth) {
    return <Box className="calendar-ghost__bar" aria-hidden="true" style={{ width: `${width}%` }} />
  }

  const lines = isList ? [50, width] : [50, width, Math.round(width * 0.7)]
  return (
    <Box className="calendar-ghost__card" aria-hidden="true">
      {lines.map((percent, index) => (
        <span key={index} className="calendar-ghost__bar" style={{ width: `${percent}%` }} />
      ))}
    </Box>
  )
}
