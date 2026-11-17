import { Box } from '@mui/material'

/**
 * One bar split by value. Segments with nothing in them are left out; an empty
 * bar is just the track. The bar is decorative: the legend next to it carries
 * the numbers, and `label` gives screen readers the same sentence.
 */
export default function SegmentedBar({ segments, label }) {
  const visible = segments.filter((segment) => segment.value > 0)

  return (
    <Box
      role="img"
      aria-label={label}
      sx={{
        display: 'flex', gap: '2px', height: 12, borderRadius: 1.5, overflow: 'hidden',
        bgcolor: 'divider',
      }}
    >
      {visible.map((segment) => (
        <Box
          key={segment.key}
          sx={{
            flex: `${segment.value} 1 0`, minWidth: 4, bgcolor: segment.color,
            '@media (prefers-reduced-motion: no-preference)': { transition: 'flex-grow 300ms ease' },
          }}
        />
      ))}
    </Box>
  )
}
