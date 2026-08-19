import { Box, Typography } from '@mui/material'

export default function HomePage() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <Typography variant="h5" fontWeight={600}>
        Welcome to ValtrimBilling
      </Typography>
    </Box>
  )
}
