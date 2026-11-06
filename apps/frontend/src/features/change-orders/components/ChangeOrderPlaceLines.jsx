import { useState } from 'react'
import {
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

import { maxPlaceLength } from '../data/changeOrders.js'
import {
  addPlaceLine,
  removePlaceLine,
  sanitizePriceInput,
  settlePriceText,
  updatePlaceLine,
} from '../utils/pricing.js'

const dollarAdornment = { startAdornment: <InputAdornment position="start">$</InputAdornment> }

/**
 * Lines that are not on a Lot (the Sales Office, a restroom, the Design Center).
 * Each one says where in words and has a Scope of Work and Amount of its own;
 * the defaults of the order are only for Lots.
 */
export default function ChangeOrderPlaceLines({ places, canAdd, onChange }) {
  // The line just added takes the cursor so the person can type its place right away.
  const [addedId, setAddedId] = useState(null)

  const handleAdd = () => {
    const next = addPlaceLine(places)
    setAddedId(next[next.length - 1].id)
    onChange(next)
  }
  const handleChange = (id, changes) => onChange(updatePlaceLine(places, id, changes))

  return (
    <Box sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" component="h3" fontWeight={700} sx={{ mb: 0.5 }}>
        Lines without a lot
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
        For work that is not on a lot, such as the Sales Office or a restroom. Each line says
        where it is and has its own Scope of Work and Amount.
      </Typography>

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
                <TableRow key={place.id} hover>
                  <TableCell sx={{ py: 1 }}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="Sales Office"
                      value={place.location}
                      autoFocus={place.id === addedId}
                      onChange={(event) => handleChange(place.id, { location: event.target.value })}
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
                      onChange={(event) => handleChange(place.id, { scope: event.target.value })}
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
                      onChange={(event) => handleChange(place.id, {
                        amount: sanitizePriceInput(event.target.value),
                      })}
                      onBlur={() => {
                        const settled = settlePriceText(place.amount)
                        if (settled !== place.amount) handleChange(place.id, { amount: settled })
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
                        onClick={() => onChange(removePlaceLine(places, place.id))}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

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
            {places.length === 0 ? 'Add a line without a lot' : 'Add another line'}
          </Button>
        </span>
      </Tooltip>
    </Box>
  )
}
