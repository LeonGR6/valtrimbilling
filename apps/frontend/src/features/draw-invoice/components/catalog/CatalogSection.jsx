import {
  Box,
  ButtonBase,
  Card,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import { keyframes } from '@mui/material/styles'
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded'

// Room kept at the right of the header for the focus button, which sits next to the chevron.
const FOCUS_BUTTON_GUTTER = 5

const bodyIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

/**
 * A collapsible section of the Draw & Invoice Packages page. The header is one compact line
 * (icon, title, count, hint) and is the toggle.
 *
 * An open section shows all of its content: there is no scroll inside it. The whole page
 * scrolls as one, so any number of open sections just make the page longer.
 *
 * `onFocus` adds a button that shows only this section (`focused` says it already is, and the
 * button then brings the others back), for when the page has grown too long to reach it.
 */
export default function CatalogSection({
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
  focused = false,
  onFocus,
  children,
}) {
  const bodyId = `${id ?? title.replace(/\s+/gu, '-').toLowerCase()}-body`

  return (
    <Card id={id} variant="outlined">
      <Box sx={{ position: 'relative' }}>
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
            sx={{
              flex: 1,
              minWidth: 0,
              display: { xs: 'none', md: 'block' },
              mr: onFocus ? FOCUS_BUTTON_GUTTER : 0,
            }}
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
        {onFocus && (
          <Tooltip title={focused ? 'Show all sections' : `Show only ${title}`}>
            <IconButton
              size="small"
              onClick={onFocus}
              aria-label={focused ? 'Show all sections' : `Show only ${title}`}
              aria-pressed={focused}
              sx={{
                position: 'absolute',
                top: '50%',
                right: 48,
                transform: 'translateY(-50%)',
                // Narrow screens have no room for it beside the title.
                display: { xs: 'none', md: 'inline-flex' },
                color: focused ? 'primary.main' : 'text.secondary',
              }}
            >
              {focused
                ? <CloseFullscreenRoundedIcon fontSize="small" />
                : <OpenInFullRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {open && (
        <Box
          id={bodyId}
          sx={{
            borderTop: 1,
            borderColor: 'divider',
            animation: `${bodyIn} 140ms ease-out`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {children}
        </Box>
      )}
    </Card>
  )
}
