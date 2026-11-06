import { Box, Typography } from '@mui/material'
import { headingDivisions } from '../../utils/calendarHeadingDates.js'

/**
 * Under the event of a Draw column: one line per date the Calendar gave it, with the lots that go on
 * that date. Nothing for an event with a single date.
 */
export default function HeadingDivisions({ heading }) {
  const divisions = headingDivisions(heading)
  if (divisions.length === 0) return null

  return (
    <Box component="ul" sx={{ m: 0, mb: 0.25, p: 0, listStyle: 'none' }}>
      {divisions.map(({ key, date, lots, extra }) => (
        <Typography
          key={key}
          component="li"
          variant="caption"
          sx={{ display: 'block', lineHeight: 1.35 }}
        >
          <Box component="span" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{date}</Box>
          {' · '}
          <Box component="span" sx={{ opacity: 0.85 }}>{`${lots}${extra ? ` · ${extra}` : ''}`}</Box>
        </Typography>
      ))}
    </Box>
  )
}
