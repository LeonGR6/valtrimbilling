import {
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'

/**
 * One document of the Package: its number, state, whether it goes in the PDF,
 * its own actions and its content. `details` shows the file at a glance.
 */
export default function DocumentCard({
  number,
  title,
  description,
  status,
  include,
  fix,
  actions,
  details,
  anchorRef,
  children,
}) {
  return (
    <Paper
      ref={anchorRef}
      variant="outlined"
      sx={{
        borderRadius: 2,
        overflow: 'hidden',
        borderColor: status.tone === 'warning' ? 'warning.main' : 'divider',
        opacity: include && !include.checked ? 0.72 : 1,
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{
          px: 2.5,
          py: 1.75,
          alignItems: { sm: 'center' },
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            color: 'primary.contrastText',
            bgcolor: 'primary.main',
            fontWeight: 800,
          }}
        >
          {number}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h6" component="h2" fontWeight={800}>
              {title}
            </Typography>
            <Chip size="small" color={status.tone} variant="outlined" label={status.label} />
          </Stack>
          <Typography variant="body2" color="text.secondary">{description}</Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {fix}
          {actions}
          {include && (
            <Tooltip title={include.hint ?? ''}>
              <span>
                <FormControlLabel
                  sx={{ m: 0 }}
                  disabled={include.disabled}
                  control={(
                    <Checkbox
                      size="small"
                      checked={include.checked}
                      onChange={(event) => include.onChange(event.target.checked)}
                    />
                  )}
                  label={<Typography variant="body2" fontWeight={650}>{include.label ?? 'In the PDF'}</Typography>}
                />
              </span>
            </Tooltip>
          )}
        </Stack>
      </Stack>
      <Box sx={{ px: 2.5, py: 2 }}>
        {details}
        {children}
      </Box>
    </Paper>
  )
}
