import { Box, Button, Stack, Tooltip, Typography } from '@mui/material'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'

import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

/** "12 lots and 2 lines without a lot", or what the lines are still missing. */
function countsText(amounts) {
  const withoutAmount = amounts.unpriced + amounts.places.unpriced
  const counts = [
    amounts.lots > 0 && plural(amounts.lots, 'lot'),
    amounts.places.count > 0 && `${plural(amounts.places.count, 'line')} without a lot`,
  ].filter(Boolean).join(' and ')

  if (!counts) return 'No lines yet'
  return withoutAmount > 0 ? `${counts}, ${withoutAmount} without an amount` : counts
}

/**
 * The bar that stays at the bottom while the form is scrolled: the total as it adds up, whether the
 * Extra / CO can be saved yet, and the way to save or leave. `problemCount` is what is still to
 * complete; `attempted` says a save was tried, so what is left is shown as a warning.
 */
export default function ChangeOrderSaveBar({
  amounts,
  problemCount,
  attempted,
  saving,
  canEdit,
  noPermission,
  saveLabel,
  onSave,
  onCancel,
}) {
  const ready = problemCount === 0

  return (
    <Box
      role="region"
      aria-label="Total and save"
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        px: { xs: 2.5, md: 4 },
        py: 1.5,
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 1.5, md: 3 }}
        sx={{ alignItems: { md: 'center' } }}
      >
        <Stack direction="row" spacing={2.5} sx={{ alignItems: 'flex-end', flexWrap: 'wrap', minWidth: 0, flex: 1 }} useFlexGap>
          <Box aria-live="polite" sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" component="div">
              Total
            </Typography>
            <Typography
              component="p"
              sx={{ m: 0, fontSize: 24, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
            >
              {amounts.total === null ? '—' : formatCurrency(amounts.total)}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            {/* The counts are for wide screens: on a phone the bar keeps to the total and the buttons. */}
            <Typography
              variant="body2"
              color="text.secondary"
              aria-live="polite"
              sx={{ display: { xs: 'none', md: 'block' } }}
            >
              {countsText(amounts)}
            </Typography>
            <Typography
              variant="body2"
              aria-live="polite"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontWeight: 600,
                color: ready ? 'success.main' : attempted ? 'warning.main' : 'text.secondary',
              }}
            >
              {ready ? (
                <>
                  <CheckCircleOutlineRoundedIcon sx={{ fontSize: 18 }} />
                  Ready to save
                </>
              ) : (
                `${plural(problemCount, 'thing')} left to fix`
              )}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            variant="outlined"
            color="inherit"
            disabled={saving}
            onClick={onCancel}
            sx={{ flex: { xs: 1, md: 'none' } }}
          >
            Cancel
          </Button>
          <Tooltip title={canEdit ? '' : noPermission}>
            <Box component="span" sx={{ flex: { xs: 2, md: 'none' }, display: 'flex' }}>
              <Button
                fullWidth
                variant="contained"
                disableElevation
                disabled={!canEdit || saving}
                onClick={onSave}
              >
                {saving ? 'Saving…' : saveLabel}
              </Button>
            </Box>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  )
}
