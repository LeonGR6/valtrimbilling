import { useState } from 'react'
import { alpha } from '@mui/material/styles'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  clearShown,
  isOptionMissingPrice,
  selectShown,
  shownPickerOptions,
  toggleOption,
} from '../utils/optionPicker.js'

// A search box earns its place once the list no longer fits in a glance.
const SEARCH_FROM = 8

/**
 * The Options of the Plan chosen for a Lot. They sit in an aligned grid, one
 * card each with the code first and the whole description under it, so a long
 * list reads as a list. With many Options there is a search, a "selected only"
 * view and select all / clear for what is shown.
 */
export default function LotOptionPicker({
  title = 'Options for selected plan',
  options,
  value,
  onChange,
  error = false,
  disabled = false,
}) {
  const [query, setQuery] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const selectedCount = options.filter((option) => value.includes(option.id)).length
  const shown = shownPickerOptions(options, { query, selectedOnly, selectedIds: value })
  const searchable = options.length >= SEARCH_FROM
  const filtering = query.trim() !== '' || selectedOnly
  const addable = shown.filter((option) => !isOptionMissingPrice(option))
  const allShownSelected = shown.length > 0 && addable.every((option) => value.includes(option.id))
  const unpricedCount = options.filter(isOptionMissingPrice).length

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ mb: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
          <Chip
            size="small"
            color={selectedCount > 0 ? 'primary' : 'default'}
            variant={selectedCount > 0 ? 'filled' : 'outlined'}
            label={`${selectedCount} of ${options.length} selected`}
            aria-live="polite"
          />
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          {searchable && (
            <Button
              size="small"
              color="inherit"
              variant={selectedOnly ? 'outlined' : 'text'}
              aria-pressed={selectedOnly}
              disabled={disabled || (selectedCount === 0 && !selectedOnly)}
              onClick={() => setSelectedOnly((current) => !current)}
            >
              Selected only
            </Button>
          )}
          <Button
            size="small"
            disabled={disabled || shown.length === 0 || allShownSelected}
            onClick={() => onChange(selectShown(value, shown))}
          >
            {filtering ? `Select shown (${shown.length})` : 'Select all'}
          </Button>
          <Button
            size="small"
            color="inherit"
            disabled={disabled || !shown.some((option) => value.includes(option.id))}
            onClick={() => onChange(clearShown(value, shown))}
          >
            {filtering ? 'Clear shown' : 'Clear'}
          </Button>
        </Stack>
      </Stack>

      {searchable && (
        <TextField
          size="small"
          fullWidth
          placeholder="Search by code or description"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ mb: 1 }}
          slotProps={{
            htmlInput: { 'aria-label': 'Search options' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end">
                  <Button
                    size="small"
                    color="inherit"
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                    sx={{ minWidth: 0, p: 0.25 }}
                  >
                    <ClearRoundedIcon fontSize="small" />
                  </Button>
                </InputAdornment>
              ) : null,
            },
          }}
        />
      )}

      {unpricedCount > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {unpricedCount === 1
            ? '1 option has no price yet and cannot be added. Set its price in Pricing first.'
            : `${unpricedCount} options have no price yet and cannot be added. Set their prices in Pricing first.`}
        </Typography>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
          maxHeight: { xs: 420, md: 380 },
          overflowY: 'auto',
          p: 0.25,
          // The scroll area keeps its own focus ring so keyboard users can reach it.
          borderRadius: 1.5,
          outline: error ? '1px solid' : 'none',
          outlineColor: 'error.main',
        }}
        role="group"
        aria-label={title}
        tabIndex={shown.length > 8 ? 0 : undefined}
      >
        {shown.map((option) => {
          const checked = value.includes(option.id)
          const missingPrice = isOptionMissingPrice(option)
          return (
            <FormControlLabel
              key={option.id}
              disabled={disabled || (missingPrice && !checked)}
              sx={(theme) => ({
                m: 0,
                pr: 1.25,
                py: 0.5,
                alignItems: 'flex-start',
                border: 1,
                borderColor: checked ? 'primary.main' : 'divider',
                borderRadius: 1.5,
                bgcolor: checked ? alpha(theme.palette.primary.main, 0.1) : 'background.paper',
                transition: 'background-color 120ms, border-color 120ms',
                '&:hover': {
                  borderColor: checked ? 'primary.main' : 'text.disabled',
                  bgcolor: checked
                    ? alpha(theme.palette.primary.main, 0.14)
                    : 'action.hover',
                },
                '&:has(:focus-visible)': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 1,
                },
                '& .MuiFormControlLabel-label': { minWidth: 0, pt: 0.75, flex: 1 },
              })}
              control={(
                <Checkbox
                  size="small"
                  checked={checked}
                  onChange={(_, next) => onChange(toggleOption(value, option.id, next))}
                />
              )}
              label={(
                <Box>
                  <Typography
                    variant="body2"
                    fontWeight={800}
                    sx={{ fontVariantNumeric: 'tabular-nums', letterSpacing: 0.2 }}
                  >
                    {option.code}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere', lineHeight: 1.4 }}
                  >
                    {option.description}
                  </Typography>
                  {missingPrice && (
                    <Typography variant="caption" color="warning.main" fontWeight={700}>
                      No price yet
                    </Typography>
                  )}
                </Box>
              )}
            />
          )
        })}
      </Box>

      {shown.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1.5, textAlign: 'center' }}>
          {selectedOnly && !query.trim()
            ? 'No options selected yet.'
            : `No options match “${query.trim()}”.`}
        </Typography>
      )}
    </Box>
  )
}
