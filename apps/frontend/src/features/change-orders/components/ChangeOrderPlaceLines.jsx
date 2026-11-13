import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'

import { parseLotRange } from '../../sequence-sheets/utils/lotRange.js'
import { maxPlaceLength } from '../data/changeOrders.js'
import {
  MAX_BULK_PLACE_LINES,
  addPlaceLine,
  addPlaceLines,
  addPlaceLinesForLots,
  removePlaceLine,
  sanitizePriceInput,
  settlePriceText,
  updatePlaceLine,
} from '../utils/pricing.js'

const dollarAdornment = { startAdornment: <InputAdornment position="start">$</InputAdornment> }

/** One line; it only draws again when its own place, Scope or Amount changes, so a long list stays quick. */
const PlaceRow = memo(function PlaceRow({ place, index, autoFocus, onChange, onRemove }) {
  return (
        <TableRow hover>
          <TableCell sx={{ py: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Sales Office"
              value={place.location}
              autoFocus={autoFocus}
              onChange={(event) => onChange(place.id, { location: event.target.value })}
              slotProps={{
                htmlInput: {
                  maxLength: maxPlaceLength,
                  'aria-label': `Place, line without a lot ${index + 1}`,
                },
              }}
            />
          </TableCell>
          <TableCell sx={{ py: 1 }}>
            <TextField
              fullWidth
              multiline
              maxRows={4}
              size="small"
              placeholder="Scope of Work"
              value={place.scope}
              onChange={(event) => onChange(place.id, { scope: event.target.value })}
              slotProps={{
                htmlInput: { 'aria-label': `Scope of Work, line without a lot ${index + 1}` },
              }}
            />
          </TableCell>
          <TableCell sx={{ py: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="0.00"
              value={place.amount}
              onChange={(event) => onChange(place.id, {
                amount: sanitizePriceInput(event.target.value),
              })}
              onBlur={() => {
                const settled = settlePriceText(place.amount)
                if (settled !== place.amount) onChange(place.id, { amount: settled })
              }}
              slotProps={{
                input: dollarAdornment,
                htmlInput: { 'aria-label': `Amount, line without a lot ${index + 1}` },
              }}
            />
          </TableCell>
          <TableCell padding="checkbox">
            <Tooltip title="Take the line off the order">
              <IconButton
                size="small"
                aria-label={`Remove line without a lot ${index + 1}`}
                onClick={() => onRemove(place.id)}
              >
                <DeleteOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </TableCell>
        </TableRow>

  )
})

/**
 * Lines that are not on a Lot of the Job yet: a place (the Sales Office, a restroom, the Design Center) or
 * Lots that are not in a Sequence Sheet yet. Each one says where in words and has a Scope of Work and Amount
 * of its own; the defaults of the order are only for Lots. Several can be added at once: a number of empty
 * lines, or a range of Lots ("12-20") that makes one line "Lot 12" ... "Lot 20".
 */
export default function ChangeOrderPlaceLines({ places, canAdd, onChange }) {
  // The line just added takes the cursor so the person can type its place right away.
  const [addedId, setAddedId] = useState(null)

  const handleAdd = () => {
    const next = addPlaceLine(places)
    setAddedId(next[next.length - 1].id)
    onChange(next)
  }
  const [bulk, setBulk] = useState(null) // null | 'count' | 'range'
  const [typed, setTyped] = useState('')
  const [bulkMessage, setBulkMessage] = useState({ severity: 'error', text: '' })

  const closeBulk = () => {
    setBulk(null)
    setTyped('')
    setBulkMessage({ severity: 'error', text: '' })
  }
  const applyBulk = () => {
    if (bulk === 'count') {
      const count = Number(typed)
      if (!Number.isInteger(count) || count < 1 || count > MAX_BULK_PLACE_LINES) {
        setBulkMessage({ severity: 'error', text: `Enter a number from 1 to ${MAX_BULK_PLACE_LINES}.` })
        return
      }
      const next = addPlaceLines(places, count)
      setAddedId(next[places.length].id)
      onChange(next)
      closeBulk()
      return
    }
    const parsed = parseLotRange(typed, MAX_BULK_PLACE_LINES * 5)
    if (!parsed.success) {
      setBulkMessage({ severity: 'error', text: parsed.error })
      return
    }
    const result = addPlaceLinesForLots(places, parsed.lotNumbers)
    if (result.added === 0) {
      setBulkMessage({ severity: 'error', text: 'Those Lots already have a line.' })
      return
    }
    setAddedId(result.places[places.length].id)
    onChange(result.places)
    if (result.skipped.length > 0 || result.tooMany) {
      setTyped('')
      setBulk(null)
      setBulkMessage({
        severity: 'info',
        text: [
          result.skipped.length > 0 && `Lot ${result.skipped.join(', ')} already had a line.`,
          result.tooMany && `Only the first ${MAX_BULK_PLACE_LINES} were added.`,
        ].filter(Boolean).join(' '),
      })
      return
    }
    closeBulk()
  }

  // Stable handlers (reading the latest lines from a ref) so the rows that did not change are not drawn again.
  const latest = useRef({ places, onChange })
  useEffect(() => {
    latest.current = { places, onChange }
  })
  const handleChange = useCallback(
    (id, changes) => latest.current.onChange(updatePlaceLine(latest.current.places, id, changes)),
    [],
  )
  const handleRemove = useCallback(
    (id) => latest.current.onChange(removePlaceLine(latest.current.places, id)),
    [],
  )

  return (
    <Box sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" component="h3" fontWeight={700} sx={{ mb: 0.5 }}>
        Other lines (not on a lot of the Job yet)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
        For work that is not on a lot of the Job, such as the Sales Office or a restroom, or for Lots that are
        not in a Sequence Sheet yet.
      </Typography>
      {bulkMessage.text && bulk === null && (
        <Alert severity={bulkMessage.severity} onClose={closeBulk} sx={{ mb: 1.5 }}>{bulkMessage.text}</Alert>
      )}

      {places.length > 0 && (
        <Box
          sx={{
            overflow: 'auto',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1.5,
            mb: 1.5,
          }}
        >
          <Table size="small" aria-label="Lines without a lot" sx={{ minWidth: 680 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 220 }}>Place</TableCell>
                <TableCell sx={{ minWidth: 260 }}>Scope of Work</TableCell>
                <TableCell sx={{ width: 140 }}>Amount</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {places.map((place, index) => (
                <PlaceRow
                  key={place.id}
                  place={place}
                  index={index}
                  autoFocus={place.id === addedId}
                  onChange={handleChange}
                  onRemove={handleRemove}
                />
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Tooltip title={canAdd ? '' : 'Choose the Job first'}>
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              disabled={!canAdd}
              onClick={handleAdd}
              sx={{ borderStyle: 'dashed' }}
            >
              {places.length === 0 ? 'Add a line' : 'Add another line'}
            </Button>
          </span>
        </Tooltip>
        <Button
          size="small"
          variant="outlined"
          disabled={!canAdd}
          onClick={() => { setBulk('count'); setTyped(''); setBulkMessage({ severity: 'error', text: '' }) }}
          sx={{ borderStyle: 'dashed' }}
        >
          Add several lines
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!canAdd}
          onClick={() => { setBulk('range'); setTyped(''); setBulkMessage({ severity: 'error', text: '' }) }}
          sx={{ borderStyle: 'dashed' }}
        >
          Add a range of lots
        </Button>
      </Box>

      {bulk && (
        <Box
          component="form"
          onSubmit={(event) => { event.preventDefault(); applyBulk() }}
          noValidate
          sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'flex-start' }}
        >
          <TextField
            autoFocus
            size="small"
            label={bulk === 'count' ? 'How many lines' : 'Lots'}
            placeholder={bulk === 'count' ? '5' : '12-20, 25'}
            value={typed}
            onChange={(event) => { setTyped(event.target.value); setBulkMessage({ severity: 'error', text: '' }) }}
            error={Boolean(bulkMessage.text)}
            helperText={bulkMessage.text || (bulk === 'count'
              ? 'That many empty lines to fill in.'
              : 'A lot such as 12 or 12A, or a range such as 12-20. One line "Lot 12" ... "Lot 20" each.')}
            sx={{ width: { xs: '100%', sm: 320 } }}
            slotProps={{ htmlInput: { inputMode: bulk === 'count' ? 'numeric' : 'text', 'aria-label': bulk === 'count' ? 'Number of lines to add' : 'Lots to add as lines' } }}
          />
          <Button type="submit" variant="contained" disableElevation sx={{ mt: 0.25 }}>Add</Button>
          <Button color="inherit" onClick={closeBulk} sx={{ mt: 0.25 }}>Cancel</Button>
        </Box>
      )}
    </Box>
  )
}
