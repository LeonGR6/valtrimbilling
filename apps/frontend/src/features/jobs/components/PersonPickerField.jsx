import { useState } from 'react'
import { Controller } from 'react-hook-form'
import {
  Autocomplete,
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import PersonAddAltRoundedIcon from '@mui/icons-material/PersonAddAltRounded'

// One field for both job roles: pick someone from the roster, or add a person
// without leaving the job form. The add button replaces the popup arrow so the
// input keeps a single icon.
export default function PersonPickerField({
  name,
  label,
  helperText,
  control,
  error,
  people,
  onCreate,
  createTitle,
  extraFields = [],
}) {
  const [draft, setDraft] = useState(null)

  const openDraft = (typed = '') => setDraft({ name: typed, email: '', phone: '' })

  const save = (field) => {
    const created = onCreate(draft)
    field.onChange(created.id)
    setDraft(null)
  }

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => {
        const selected = people.find((person) => person.id === field.value) ?? null

        return (
          <Box sx={{ width: '100%' }}>
            <Autocomplete
              options={people}
              value={selected}
              openOnFocus
              disableClearable
              // forcePopupIcon also drops the hasPopupIcon class; popupIcon={null}
              // only hides the arrow and leaves its 39px of reserved padding.
              forcePopupIcon={false}
              getOptionLabel={(option) => option.name}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              sx={{ '& .MuiOutlinedInput-root': { pr: 1 } }}
              onChange={(_, next) => field.onChange(next ? next.id : null)}
              onBlur={field.onBlur}
              noOptionsText={
                <Box sx={{ textAlign: 'center', py: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    Nobody matches that name
                  </Typography>
                  <Typography variant="caption" color="primary.main">
                    Use + to add them
                  </Typography>
                </Box>
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={label}
                  error={Boolean(error)}
                  helperText={error?.message ?? helperText}
                  // MUI 9 hands the input wiring over in params.slotProps —
                  // the older InputProps / inputProps pair no longer exists.
                  slotProps={{
                    ...params.slotProps,
                    input: {
                      ...params.slotProps.input,
                      endAdornment: (
                        <Tooltip title={createTitle}>
                          <IconButton
                            size="small"
                            aria-label={createTitle}
                            // Without this the Autocomplete reads the click as
                            // "toggle the list" and opens it over the panel.
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() =>
                              openDraft(params.slotProps.htmlInput.value ?? '')
                            }
                            sx={{
                              width: 28,
                              height: 28,
                              bgcolor: 'primary.light',
                              color: 'primary.main',
                            }}
                          >
                            <AddRoundedIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Tooltip>
                      ),
                    },
                  }}
                />
              )}
            />

            {draft && (
              <Box
                sx={{
                  mt: 1,
                  p: 1.75,
                  borderRadius: 2,
                  border: 1,
                  borderColor: 'primary.main',
                  bgcolor: 'primary.light',
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
                  <PersonAddAltRoundedIcon fontSize="small" sx={{ color: 'primary.main' }} />
                  <Typography variant="body2" fontWeight={700} color="primary.main">
                    {createTitle}
                  </Typography>
                </Stack>

                <Stack spacing={1.5}>
                  <TextField
                    label="Name"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    size="small"
                    fullWidth
                    autoFocus
                  />
                  <TextField
                    label="Email"
                    value={draft.email}
                    onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                    size="small"
                    fullWidth
                  />
                  {extraFields.includes('phone') && (
                    <TextField
                      label="Phone"
                      value={draft.phone}
                      onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                      size="small"
                      fullWidth
                    />
                  )}
                </Stack>

                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 1.5 }}>
                  <Button size="small" color="inherit" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    disabled={!draft.name.trim()}
                    onClick={() => save(field)}
                  >
                    Save and assign
                  </Button>
                </Stack>
              </Box>
            )}
          </Box>
        )
      }}
    />
  )
}
