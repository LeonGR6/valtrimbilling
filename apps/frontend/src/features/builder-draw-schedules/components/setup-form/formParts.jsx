import {
  Box,
  Collapse,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { Controller, useFormContext } from 'react-hook-form'

/** One part of the form, set apart from the one above it by a thin rule. */
export function Section({ title, hint = null, children }) {
  return (
    <Box
      component="section"
      sx={{ '&:not(:first-of-type)': { borderTop: 1, borderColor: 'divider', pt: 3 } }}
    >
      <Typography variant="subtitle1" component="h3" fontWeight={800}>{title}</Typography>
      {hint && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, maxWidth: 560 }}>
          {hint}
        </Typography>
      )}
      <Stack spacing={2.5} sx={{ mt: 2 }}>{children}</Stack>
    </Box>
  )
}

/**
 * An option that is on or off, said in a sentence. What it needs once it is on opens under it,
 * so the form is as long as the setup is, not as long as it could be.
 */
export function ToggleRow({ name, label, description, onChange = undefined, children = null }) {
  const { control } = useFormContext()

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Box>
          <FormControlLabel
            sx={{ m: 0, alignItems: 'flex-start', gap: 1.25 }}
            control={(
              <Switch
                checked={Boolean(field.value)}
                onChange={(_, checked) => {
                  field.onChange(checked)
                  onChange?.(checked)
                }}
                sx={{ mt: -0.25 }}
              />
            )}
            label={(
              <Box sx={{ pt: 0.5 }}>
                <Typography fontWeight={700}>{label}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
                  {description}
                </Typography>
              </Box>
            )}
          />
          {children && (
            <Collapse in={Boolean(field.value)} unmountOnExit>
              <Box sx={{ pl: { xs: 0, sm: 8.5 }, pt: 1.5 }}>{children}</Box>
            </Collapse>
          )}
        </Box>
      )}
    />
  )
}
