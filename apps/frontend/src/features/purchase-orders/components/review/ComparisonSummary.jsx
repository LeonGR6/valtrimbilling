import { Box, Button, ButtonBase, Stack, Typography } from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded'
import { describeVerdict, statusBreakdown } from '../../services/purchaseOrderRecord.js'

// The same semantic colors everywhere in the review: a result's color is its theme color.
const dot = (color) => `${color}.main`

// What a result's button says, for the results an import can fix.
const IMPORT_LABELS = {
  NOT_IN_LOT: (count) => `Add ${count} to the ${count === 1 ? 'Lot' : 'Lots'}`,
  MISSING_OPTION: (count) => `Create and add ${count}`,
}

/**
 * The top of the review: how many options match, a bar that shows the proportion of each
 * result, and one row per result with what it means and, when an import can fix it, the
 * button that does. A row also filters the work orders below to that result.
 */
export default function ComparisonSummary({
  summary,
  activeStatus,
  onSelectStatus,
  importableByStatus,
  onImport,
}) {
  const verdict = describeVerdict(summary)
  const breakdown = statusBreakdown(summary)

  return (
    <Box
      sx={(theme) => ({
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        borderLeft: 4,
        borderLeftColor: verdict.tone === 'neutral'
          ? theme.palette.divider
          : theme.palette[verdict.tone].main,
      })}
    >
      <Box sx={{ px: 2.25, pt: 2, pb: breakdown.length > 0 ? 1.5 : 2 }}>
        <Typography component="h2" variant="h6" fontWeight={850} sx={{ lineHeight: 1.25 }}>
          {verdict.headline}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {verdict.detail}
        </Typography>

        {breakdown.length > 0 && (
          <Box
            role="img"
            aria-label={breakdown.map((item) => `${item.count} ${item.label}`).join(', ')}
            sx={{
              mt: 1.75,
              display: 'flex',
              height: 10,
              gap: '3px',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            {breakdown.map((item) => (
              <Box
                key={item.key}
                sx={{
                  flex: `${item.count} 1 0`,
                  minWidth: 8,
                  bgcolor: dot(item.color),
                  opacity: activeStatus && activeStatus !== item.key ? 0.28 : 1,
                  transition: 'opacity 150ms',
                }}
              />
            ))}
          </Box>
        )}
      </Box>

      {breakdown.length > 0 && (
        <Stack>
          {breakdown.map((item) => {
            const selected = activeStatus === item.key
            const importable = importableByStatus?.[item.key] ?? []
            const importLabel = IMPORT_LABELS[item.key]
            return (
              <Stack
                key={item.key}
                // The button sits beside the text where there is room, and under it on a phone.
                direction={{ xs: 'column', sm: 'row' }}
                sx={{
                  alignItems: { xs: 'stretch', sm: 'center' },
                  borderTop: 1,
                  borderColor: 'divider',
                  bgcolor: selected ? 'action.selected' : 'transparent',
                }}
              >
                <ButtonBase
                  onClick={() => onSelectStatus(selected ? null : item.key)}
                  aria-pressed={selected}
                  aria-label={`${selected ? 'Show all' : 'Show only'}: ${item.count} ${item.label}`}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    px: 2.25,
                    py: 1,
                    gap: 1.5,
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    '&:hover': { bgcolor: selected ? 'transparent' : 'action.hover' },
                    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                  }}
                >
                  {item.color === 'success'
                    ? <CheckCircleRoundedIcon sx={{ color: dot(item.color), fontSize: 18 }} />
                    : (
                      <Box
                        sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: dot(item.color), mx: '4px', flexShrink: 0 }}
                      />
                    )}
                  <Typography
                    fontWeight={850}
                    sx={{ width: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                  >
                    {item.count}
                  </Typography>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={750}>{item.label}</Typography>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.35 }}>
                      {item.hint}
                      {item.advice ? ` ${item.advice}` : ''}
                    </Typography>
                  </Box>
                </ButtonBase>
                {importLabel && importable.length > 0 && onImport && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PlaylistAddRoundedIcon />}
                    onClick={() => onImport(importable)}
                    sx={{
                      mr: { sm: 2 },
                      ml: { xs: '66px', sm: 0 },
                      mb: { xs: 1.25, sm: 0 },
                      alignSelf: { xs: 'flex-start', sm: 'center' },
                      flexShrink: 0,
                      textTransform: 'none',
                    }}
                  >
                    {importLabel(importable.length)}
                  </Button>
                )}
              </Stack>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}
