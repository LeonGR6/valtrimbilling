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
import InternationalPhoneInput from '../../../components/common/InternationalPhoneInput.jsx'
import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'

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

  const openDraft = (typed = '') => setDraft({
    name: typed,
    email: '',
    phone: '',
    phoneCountry: 'US',
  })
  const draftEmailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    draft?.email.trim() ?? '',
  )
  const normalizedDraftPhone = normalizePhoneNumber(
    draft?.phone ?? '',
    draft?.phoneCountry ?? 'US',
  )
  const draftPhoneIsValid = !draft?.phone.trim() || Boolean(normalizedDraftPhone)

  const save = (field) => {
    if (!onCreate || !draft) return
    const contactDraft = Object.fromEntries(
      Object.entries(draft).filter(([key]) => key !== 'phoneCountry'),
    )
    const created = onCreate({
      ...contactDraft,
      phone: normalizedDraftPhone ?? '',
    })
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
              forcePopupIcon={onCreate ? false : 'auto'}
              getOptionLabel={(option) => option.name}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              sx={{ '& .MuiOutlinedInput-root': { pr: 1 } }}
              onChange={(_, next) => field.onChange(next ? next.id : null)}
              onBlur={field.onBlur}
              noOptionsText={onCreate
                ? (
                    <Box sx={{ textAlign: 'center', py: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        Nobody matches that name
                      </Typography>
                      <Typography variant="caption" color="primary.main">
                        Use + to add them
                      </Typography>
                    </Box>
                  )
                : 'Nobody matches that name'}
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
                      endAdornment: onCreate
                        ? (
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
                          )
                        : params.slotProps.input.endAdornment,
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
                    error={Boolean(draft.email) && !draftEmailIsValid}
                    helperText={
                      draft.email && !draftEmailIsValid
                        ? 'Enter a valid email address.'
                        : 'Required'
                    }
                    size="small"
                    fullWidth
                    required
                  />
                  {extraFields.includes('phone') && (
                    <InternationalPhoneInput
                      label="Phone number"
                      value={draft.phone}
                      country={draft.phoneCountry}
                      onChange={(phone) => setDraft((current) => ({ ...current, phone }))}
                      onCountryChange={(phoneCountry) => setDraft((current) => ({
                        ...current,
                        phoneCountry,
                      }))}
                      error={!draftPhoneIsValid}
                      helperText={draftPhoneIsValid
                        ? 'Optional · choose +1 or +52'
                        : 'Enter a 10-digit U.S. or Mexico phone number.'}
                      size="small"
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
                    disabled={!draft.name.trim() || !draftEmailIsValid || !draftPhoneIsValid}
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
