import {
  Box,
  ButtonBase,
  Chip,
  Collapse,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'

// The rail says how the section stands, and it is the only place colour is used for
// that: green is complete, amber needs a look, red is a required document that is
// missing, grey is optional and empty.
const RAIL_COLORS = {
  ok: 'success.main',
  attention: 'warning.main',
  missing: 'error.main',
  idle: 'divider',
}

/**
 * One kind of document of a Job: a line with its name, a summary and its state, which
 * opens onto its files. `action` is the one button the section offers (add, fill in).
 */
export default function DocumentSection({
  id,
  title,
  status,
  open,
  onToggle,
  action = null,
  children,
}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  return (
    <Box
      id={id}
      sx={{
        display: 'flex',
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0 },
        scrollMarginTop: 12,
      }}
    >
      <Box
        aria-hidden="true"
        sx={{ width: 3, flexShrink: 0, bgcolor: RAIL_COLORS[status.tone] ?? 'divider' }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <ButtonBase
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`${id}-body`}
            sx={{
              flex: 1,
              minWidth: 0,
              justifyContent: 'flex-start',
              textAlign: 'left',
              gap: 1.25,
              px: 1.75,
              py: 1.5,
              flexWrap: 'wrap',
              '&:hover': { bgcolor: 'action.hover' },
              '&.Mui-focusVisible': { bgcolor: 'action.hover' },
            }}
          >
            <ChevronRightRoundedIcon
              fontSize="small"
              sx={{
                color: 'text.secondary',
                transform: open ? 'rotate(90deg)' : 'none',
                transition: reduceMotion ? 'none' : 'transform 150ms',
              }}
            />
            <Typography fontWeight={650}>{title}</Typography>
            {/* On a phone the summary drops to a second line instead of being squeezed. */}
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                order: { xs: 3, sm: 1 },
                flex: { xs: '1 1 100%', sm: '1 1 0' },
                minWidth: 0,
                pl: { xs: 4, sm: 0 },
                whiteSpace: { xs: 'normal', sm: 'nowrap' },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {status.summary}
            </Typography>
            {status.badge && (
              <Chip
                size="small"
                color={status.badge.color}
                variant={status.badge.color === 'success' ? 'outlined' : 'filled'}
                label={status.badge.label}
                sx={{ order: { xs: 2, sm: 2 }, ml: { xs: 'auto', sm: 0 } }}
              />
            )}
          </ButtonBase>
          {action && <Box sx={{ pr: 1.25, flexShrink: 0 }}>{action}</Box>}
        </Stack>

        <Collapse in={open} timeout={reduceMotion ? 0 : 'auto'} unmountOnExit>
          <Box id={`${id}-body`} sx={{ px: { xs: 1, sm: 2 }, pb: 1.5, pl: { xs: 1.5, sm: 4.75 } }}>
            {children}
          </Box>
        </Collapse>
      </Box>
    </Box>
  )
}
