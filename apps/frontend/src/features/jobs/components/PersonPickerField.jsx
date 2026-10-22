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
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PersonAddAltRoundedIcon from '@mui/icons-material/PersonAddAltRounded'
import InternationalPhoneInput from '../../../components/common/InternationalPhoneInput.jsx'
import {
  getNationalPhoneNumber,
  getPhoneCountry,
  normalizePhoneNumber,
} from '../../../utils/phoneNumbers.js'

// One field for both job roles: pick someone from the roster, add a person, or
// fix the selected person's details without leaving the job form. The action
// buttons replace the popup arrow so the input keeps a tidy set of icons.
export default function PersonPickerField({
  name,
  label,
  helperText,
  control,
  error,
  optional = false,
  people,
  onCreate,
  onUpdate,
  optionCaption,
  selectedNote,
  createTitle,
  editTitle,
  extraFields = [],
}) {
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState('')

  const openDraft = (typed = '') => {
    setCreateError('')
    setDraft({
      name: typed,
      email: '',
      phone: '',
      phoneCountry: 'US',
      territory: '',
    })
  }
  const openEditDraft = (person) => {
    setCreateError('')
    const phoneCountry = getPhoneCountry(person.phone)
    setDraft({
      id: person.id,
      name: person.name ?? '',
      email: person.email ?? '',
      phone: getNationalPhoneNumber(person.phone, phoneCountry),
      phoneCountry,
      territory: person.territory ?? '',
    })
  }
  const needsTerritory = extraFields.includes('territory')
  const draftTerritoryIsValid = !needsTerritory || Boolean(draft?.territory.trim())
  const draftEmailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    draft?.email.trim() ?? '',
  )
  const normalizedDraftPhone = normalizePhoneNumber(
    draft?.phone ?? '',
    draft?.phoneCountry ?? 'US',
  )
  const draftPhoneIsValid = !draft?.phone.trim() || Boolean(normalizedDraftPhone)

  const save = async (field) => {
    if (!draft || !(draft.id ? onUpdate : onCreate)) return
    const contactDraft = Object.fromEntries(
      Object.entries(draft).filter(([key]) => !['id', 'phoneCountry'].includes(key)),
    )
    const payload = {
      ...contactDraft,
      phone: normalizedDraftPhone ?? '',
    }
    setSaving(true)
    setCreateError('')
    try {
      const saved = draft.id ? await onUpdate(draft.id, payload) : await onCreate(payload)
      field.onChange(saved.id)
      setDraft(null)
    } catch (error) {
      setCreateError(error.message)
    } finally {
      setSaving(false)
    }
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
              disableClearable={!optional}
              // forcePopupIcon also drops the hasPopupIcon class; popupIcon={null}
              // only hides the arrow and leaves its 39px of reserved padding.
              forcePopupIcon={onCreate || onUpdate ? false : 'auto'}
              getOptionLabel={(option) => option.name}
              renderOption={optionCaption
                ? (optionProps, option) => {
                    const { key, ...rest } = optionProps
                    return (
                      <li key={key} {...rest}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2">{option.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {optionCaption(option)}
                          </Typography>
                        </Box>
                      </li>
                    )
                  }
                : undefined}
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
                  helperText={error?.message
                    ?? (selected && selectedNote?.(selected))
                    ?? helperText
                    ?? (optional ? 'Optional' : undefined)}
                  // MUI 9 hands the input wiring over in params.slotProps —
                  // the older InputProps / inputProps pair no longer exists.
                  slotProps={{
                    ...params.slotProps,
                    input: {
                      ...params.slotProps.input,
                      endAdornment: onCreate || onUpdate
                        ? (
                            <Stack direction="row" spacing={0.5}>
                              {optional && selected && (
                                <Tooltip title="Clear">
                                  <IconButton
                                    size="small"
                                    aria-label={`Clear ${label}`}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => field.onChange(null)}
                                    sx={{ width: 28, height: 28, color: 'text.secondary' }}
                                  >
                                    <ClearRoundedIcon sx={{ fontSize: 18 }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {onUpdate && selected && (
                                <Tooltip title={editTitle}>
                                  <IconButton
                                    size="small"
                                    aria-label={editTitle}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => openEditDraft(selected)}
                                    sx={{
                                      width: 28,
                                      height: 28,
                                      bgcolor: 'action.hover',
                                      color: 'text.secondary',
                                    }}
                                  >
                                    <EditOutlinedIcon sx={{ fontSize: 18 }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {onCreate && (
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
                              )}
                            </Stack>
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
                    {draft.id ? editTitle : createTitle}
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
                  {needsTerritory && (
                    <TextField
                      label="Territory"
                      value={draft.territory}
                      onChange={(event) => setDraft({ ...draft, territory: event.target.value })}
                      helperText="Required · example: Inland Empire"
                      size="small"
                      fullWidth
                      required
                      slotProps={{ htmlInput: { maxLength: 80 } }}
                    />
                  )}
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
                  {createError && (
                    <Typography
                      variant="caption"
                      color="error.main"
                      sx={{ flex: 1, alignSelf: 'center' }}
                    >
                      {createError}
                    </Typography>
                  )}
                  <Button
                    size="small"
                    color="inherit"
                    disabled={saving}
                    onClick={() => {
                      setDraft(null)
                      setCreateError('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    disabled={
                      saving
                      || !draft.name.trim()
                      || !draftEmailIsValid
                      || !draftPhoneIsValid
                      || !draftTerritoryIsValid
                    }
                    onClick={() => save(field)}
                  >
                    {saving ? 'Saving...' : draft.id ? 'Save changes' : 'Save and assign'}
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
