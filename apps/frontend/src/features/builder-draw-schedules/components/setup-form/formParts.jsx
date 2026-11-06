import {
  Box,
  Chip,
  Collapse,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { Controller, useFormContext } from 'react-hook-form'
import { useFormIssues } from './formIssues.js'

/**
 * One part of the form, set apart from the one above it by a thin rule. Once the person has tried
 * to save, a part with problems carries a red rule at its left and says how many it has, so it is
 * found without reading the form; the problems themselves are on their fields.
 */
export function Section({ id = null, title, hint = null, children }) {
  const { showErrors, counts } = useFormIssues()
  const count = id && showErrors ? (counts[id] ?? 0) : 0

  return (
    <Box
      component="section"
      id={id ? `setup-section-${id}` : undefined}
      sx={{ '&:not(:first-of-type)': { borderTop: 1, borderColor: 'divider', pt: 3 } }}
    >
      <Box
        sx={{
          // The rule sits in the gutter of the dialog, so the fields do not move when it appears.
          borderLeft: '3px solid',
          borderColor: count > 0 ? 'error.main' : 'transparent',
          pl: '16px',
          ml: '-19px',
          transition: (theme) => theme.transitions.create('border-color', { duration: 150 }),
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="subtitle1" component="h3" fontWeight={800}>{title}</Typography>
          {count > 0 && (
            <Chip size="small" color="error" label={`${count} to fix`} sx={{ fontWeight: 700 }} />
          )}
        </Stack>
        {hint && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, maxWidth: 560 }}>
            {hint}
          </Typography>
        )}
        <Stack spacing={2.5} sx={{ mt: 2 }}>{children}</Stack>
      </Box>
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
