import {
  Box,
  ButtonBase,
  Card,
  Chip,
  CircularProgress,
  Collapse,
  Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'

// The cutoff or release rows only need a few lines of the page: a long list
// scrolls inside the card instead of pushing the Packages table out of view.
const BODY_MAX_HEIGHT = 340

/**
 * A collapsible card for the suggestion lists above the Packages table. The
 * header is one compact line (icon, title, count, hint) and is the toggle, so
 * the list can be folded away once the person has seen it.
 */
export default function SuggestionsCard({
  id,
  icon,
  iconSx,
  title,
  count,
  countColor = 'primary',
  hint,
  loading = false,
  open,
  onToggle,
  children,
}) {
  const bodyId = `${id ?? title.replace(/\s+/gu, '-').toLowerCase()}-body`

  return (
    <Card id={id} variant="outlined" sx={{ overflow: 'hidden' }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        sx={{
          width: '100%',
          px: { xs: 1.5, md: 2 },
          py: 1,
          gap: 1.25,
          justifyContent: 'flex-start',
          textAlign: 'left',
          '&:hover': { bgcolor: 'action.hover' },
          '&.Mui-focusVisible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        <Box
          sx={{
            width: 30,
            height: 30,
            flexShrink: 0,
            borderRadius: 1.25,
            display: 'grid',
            placeItems: 'center',
            '& svg': { fontSize: 18 },
            ...iconSx,
          }}
        >
          {icon}
        </Box>
        <Typography fontWeight={800} sx={{ flexShrink: 0 }}>{title}</Typography>
        {count != null && count > 0 && (
          <Chip size="small" color={countColor} label={count} sx={{ height: 20, fontWeight: 800 }} />
        )}
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          sx={{ flex: 1, minWidth: 0, display: { xs: 'none', md: 'block' } }}
        >
          {hint}
        </Typography>
        {loading && <CircularProgress size={18} aria-label={`Loading ${title}`} />}
        <ExpandMoreRoundedIcon
          color="action"
          sx={{
            ml: 'auto',
            flexShrink: 0,
            transition: 'transform 160ms',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </ButtonBase>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box
          id={bodyId}
          sx={{ maxHeight: BODY_MAX_HEIGHT, overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}
        >
          {children}
        </Box>
      </Collapse>
    </Card>
  )
}
