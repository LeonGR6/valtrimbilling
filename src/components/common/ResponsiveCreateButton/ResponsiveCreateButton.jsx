import { Box, Button } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'

export default function ResponsiveCreateButton({
  label,
  mobileLabel = 'New',
  sx,
  ...buttonProps
}) {
  const responsiveStyles = {
    width: { xs: '100%', sm: 'auto' },
    alignSelf: { xs: 'stretch', sm: 'center' },
    flexShrink: 0,
    whiteSpace: 'nowrap',
  }

  return (
    <Button
      variant="contained"
      startIcon={<AddRoundedIcon />}
      disableElevation
      {...buttonProps}
      aria-label={buttonProps['aria-label'] ?? label}
      sx={[responsiveStyles, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
    >
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        {label}
      </Box>
      <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
        {mobileLabel}
      </Box>
    </Button>
  )
}
