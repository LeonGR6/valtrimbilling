import { Box, CircularProgress } from '@mui/material'

export default function RouteLoading() {
  return (
    <Box
      role="status"
      aria-label="Loading page"
      sx={{ display: 'grid', height: '100%', minHeight: 240, placeItems: 'center' }}
    >
      <CircularProgress size={32} />
    </Box>
  )
}
