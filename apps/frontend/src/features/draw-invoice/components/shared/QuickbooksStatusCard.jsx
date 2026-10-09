import { Box, ButtonBase, Tooltip, Typography } from '@mui/material'
import QuickbooksLogo from './QuickbooksLogo.jsx'

const TONE_COLORS = {
  success: 'success.main',
  warning: 'warning.main',
  neutral: 'text.secondary',
}

/**
 * QuickBooks logo, a status word in the tone's colour, one line of detail and a
 * status dot. It is a button when `onClick` is given, a link when `href` is
 * given, and plain information otherwise.
 */
export default function QuickbooksStatusCard({
  tone = 'neutral',
  status,
  detail,
  title,
  onClick,
  href,
}) {
  const color = TONE_COLORS[tone]
  const interactive = Boolean(onClick || href)
  const linkProps = href
    ? { component: 'a', href, target: '_blank', rel: 'noopener noreferrer' }
    : {}

  return (
    <Tooltip title={title ?? ''}>
      <ButtonBase
        {...linkProps}
        onClick={onClick}
        aria-label={`QuickBooks ${status}. ${detail}${href ? ' Opens in QuickBooks.' : ''}`}
        aria-disabled={!interactive}
        sx={{
          gap: 1.5,
          pl: 1,
          pr: 1.75,
          py: 0.75,
          minWidth: 220,
          justifyContent: 'flex-start',
          textAlign: 'left',
          border: 1,
          borderColor: tone === 'neutral' ? 'divider' : color,
          borderRadius: 2,
          bgcolor: 'background.paper',
          cursor: interactive ? 'pointer' : 'default',
          transition: 'border-color 120ms, background-color 120ms',
          '&:hover': interactive ? { borderColor: color, bgcolor: 'action.hover' } : undefined,
          '&.Mui-focusVisible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
        }}
      >
        <QuickbooksLogo size={38} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="span" sx={{ display: 'block', lineHeight: 1.3 }}>
            <Box component="span" sx={{ fontWeight: 800 }}>QuickBooks</Box>
            {' '}
            <Box component="span" sx={{ fontWeight: 700, color }}>
              {status}
            </Box>
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.4, maxWidth: 240 }}
          >
            {detail}
          </Typography>
        </Box>
        <Box
          aria-hidden
          sx={{
            width: 9,
            height: 9,
            flexShrink: 0,
            borderRadius: '50%',
            bgcolor: color,
            opacity: tone === 'neutral' ? 0.45 : 1,
            boxShadow: tone === 'neutral' ? 'none' : '0 0 8px currentColor',
            color,
          }}
        />
      </ButtonBase>
    </Tooltip>
  )
}
