import { useState } from 'react'
import { alpha } from '@mui/material/styles'
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  MAX_LOCATION_LENGTH,
  MAX_OPTION_QUANTITY,
  detailOf,
  setOptionLocations,
  setOptionQuantity,
} from '../utils/optionDetails.js'
import {
  clearShown,
  isOptionMissingPrice,
  selectShown,
  shownPickerOptions,
  toggleOption,
} from '../utils/optionPicker.js'

// A search box earns its place once the list no longer fits in a glance.
const SEARCH_FROM = 8

// Places offered while typing a location; any other text is accepted too.
const LOCATION_SUGGESTIONS = ['1st floor', '2nd floor', '3rd floor', 'Basement', 'Garage', 'Attic']

/**
 * How many units of a selected Option the Lot has and where they go. Outside the label of the Option, so
 * typing here never ticks or unticks it.
 */
function OptionDetailFields({ option, detail, disabled, onChange }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      sx={{ px: 1.25, pb: 1, pl: 4.75, alignItems: { sm: 'flex-start' } }}
    >
      <Stack
        direction="row"
        role="group"
        aria-label={`Quantity of ${option.code}`}
        sx={{ alignItems: 'center', flexShrink: 0, height: 40 }}
      >
        <IconButton
          size="small"
          aria-label={`Fewer units of ${option.code}`}
          disabled={disabled || detail.quantity <= 1}
          onClick={() => onChange((details) => setOptionQuantity(details, option.id, detail.quantity - 1))}
        >
          <RemoveRoundedIcon fontSize="small" />
        </IconButton>
        <Typography
          variant="body2"
          fontWeight={700}
          aria-live="polite"
          sx={{ minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
        >
          ×{detail.quantity}
        </Typography>
        <IconButton
          size="small"
          aria-label={`More units of ${option.code}`}
          disabled={disabled || detail.quantity >= MAX_OPTION_QUANTITY}
          onClick={() => onChange((details) => setOptionQuantity(details, option.id, detail.quantity + 1))}
        >
          <AddRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Autocomplete
        multiple
        freeSolo
        autoSelect
        filterSelectedOptions
        size="small"
        sx={{ flex: 1, minWidth: 0 }}
        disabled={disabled}
        options={LOCATION_SUGGESTIONS}
        value={detail.locations}
        onChange={(_, next) => onChange((details) => setOptionLocations(details, option.id, next))}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Locations"
            placeholder={detail.locations.length === 0 ? '1st floor, 2nd floor…' : ''}
            helperText={detail.quantity > 1 && detail.locations.length < detail.quantity
              ? `${detail.quantity - detail.locations.length} of ${detail.quantity} without a location`
              : undefined}
            slotProps={{
              ...params.slotProps,
              htmlInput: { ...params.slotProps?.htmlInput, maxLength: MAX_LOCATION_LENGTH, 'aria-label': `Locations of ${option.code}` },
            }}
          />
        )}
      />
    </Stack>
  )
}

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
  // The quantity and locations of the selected Options (by Option id). Without `onDetailsChange` the
  // Options are just ticked, one unit each.
  details = {},
  onDetailsChange = null,
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
          const detail = detailOf(details, option.id)
          return (
            <Box
              key={option.id}
              sx={(theme) => ({
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
                '&:has(input[type="checkbox"]:focus-visible)': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 1,
                },
              })}
            >
              <FormControlLabel
                disabled={disabled || (missingPrice && !checked)}
                sx={{
                  m: 0,
                  pr: 1.25,
                  py: 0.5,
                  width: '100%',
                  alignItems: 'flex-start',
                  '& .MuiFormControlLabel-label': { minWidth: 0, pt: 0.75, flex: 1 },
                }}
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
              {checked && onDetailsChange && (
                <OptionDetailFields
                  option={option}
                  detail={detail}
                  disabled={disabled}
                  onChange={(update) => onDetailsChange(update(details))}
                />
              )}
            </Box>
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
