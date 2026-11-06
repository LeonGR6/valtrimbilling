import { Box, FormLabel } from '@mui/material'

// A form field with its label above, as in the Extra / Change Order cards.
export default function ChangeOrderField({ label, required, children, sx }) {
  return (
    <Box sx={sx}>
      <FormLabel
        required={required}
        sx={{ display: 'block', mb: 0.75, fontSize: 14, color: 'text.primary' }}
      >
        {label}
      </FormLabel>
      {children}
    </Box>
  )
}
