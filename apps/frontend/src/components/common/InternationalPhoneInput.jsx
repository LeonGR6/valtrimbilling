import { useId } from 'react'
import { Controller } from 'react-hook-form'
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import {
  detectPhoneCountry,
  formatPhoneNumber,
  normalizePhoneNumber,
  phoneCountryOptions,
} from '../../utils/phoneNumbers.js'

export default function InternationalPhoneInput({
  label,
  value,
  country = 'US',
  onChange,
  onCountryChange,
  onBlur,
  error,
  helperText,
  size,
}) {
  const labelId = useId()
  const normalized = normalizePhoneNumber(value, country)
  const resolvedHelperText = error
    ? helperText
    : normalized
      ? `Saved as ${formatPhoneNumber(normalized)}`
      : helperText

  const changeValue = (event) => {
    const nextValue = event.target.value
    const detectedCountry = detectPhoneCountry(nextValue)
    if (detectedCountry && detectedCountry !== country) onCountryChange(detectedCountry)
    onChange(nextValue)
  }

  return (
    <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'flex-start' }}>
      <FormControl size={size} sx={{ flex: '0 0 126px' }}>
        <InputLabel id={labelId}>Country</InputLabel>
        <Select
          labelId={labelId}
          label="Country"
          value={country}
          onChange={(event) => onCountryChange(event.target.value)}
          aria-label={`${label} country code`}
        >
          {phoneCountryOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.value} {option.dialCode}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        label={label}
        type="tel"
        value={value}
        onChange={changeValue}
        onBlur={onBlur}
        error={error}
        helperText={resolvedHelperText}
        placeholder={country === 'MX' ? '55 1234 5678' : '714 555 0162'}
        fullWidth
        size={size}
        slotProps={{ htmlInput: { maxLength: 30, inputMode: 'tel' } }}
      />
    </Stack>
  )
}

export function FormPhoneInput({ control, name, error, ...props }) {
  const countryName = `${name}Country`

  return (
    <Controller
      name={countryName}
      control={control}
      render={({ field: countryField }) => (
        <Controller
          name={name}
          control={control}
          render={({ field: phoneField }) => (
            <InternationalPhoneInput
              {...props}
              value={phoneField.value ?? ''}
              country={countryField.value ?? 'US'}
              onChange={phoneField.onChange}
              onCountryChange={countryField.onChange}
              onBlur={phoneField.onBlur}
              error={Boolean(error)}
              helperText={error?.message ?? props.helperText}
            />
          )}
        />
      )}
    />
  )
}
