import { useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'

import { useChangeOrderCoverage } from '../hooks/useChangeOrderCoverage.js'
import { filterCoverageRows } from '../utils/coverage.js'
import {
  clearLineOverrides,
  dropAmountsEqualToDefault,
  sanitizePriceInput,
  setLineOverride,
  settleLineAmounts,
  settlePriceText,
} from '../utils/pricing.js'
import Field from './ChangeOrderField.jsx'
import ChangeOrderPlaceLines from './ChangeOrderPlaceLines.jsx'

// A value the Lot has of its own, not the default one.
const ownValueSx = { '& .MuiOutlinedInput-root': { bgcolor: 'primary.light' } }

const dollarAdornment = { startAdornment: <InputAdornment position="start">$</InputAdornment> }

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

/**
 * Every Lot the coverage reaches is a line of the order. The default Scope of
 * Work and Amount go to all of them; a line can be given its own, one by one
 * or for the Lots ticked in the table. Work that is not on a Lot (the Sales
 * Office) is added below as a line without a Lot.
 */
export default function ChangeOrderLinesCard({ values, onChange }) {
  const { job, lines } = useChangeOrderCoverage(values)
  const [search, setSearch] = useState('')
  const [checked, setChecked] = useState(() => new Set())
  const [bulk, setBulk] = useState({ amount: '', scope: '' })

  const visible = filterCoverageRows(lines, search)
  const selectedIds = lines.filter((line) => checked.has(line.lotId)).map((line) => line.lotId)
  const visibleChecked = visible.filter((line) => checked.has(line.lotId)).length

  const setOverrides = (lineOverrides) => onChange({ lineOverrides })
  const setOwn = (lotIds, field, value) => (
    setOverrides(setLineOverride(values.lineOverrides, lotIds, field, value, {
      scope: values.defaultScope,
      amount: values.defaultAmount,
    }))
  )
  // "1689.6" becomes "1689.60", and typed over a default of "1689.60" it is the same price, not a value of its own.
  const settleAmounts = () => {
    const settled = settleLineAmounts(values.lineOverrides, values.defaultAmount)
    if (JSON.stringify(settled) !== JSON.stringify(values.lineOverrides)) setOverrides(settled)
  }

  const toggleLot = (lotId) => setChecked((current) => {
    const next = new Set(current)
    if (!next.delete(lotId)) next.add(lotId)
    return next
  })
  const toggleVisible = () => setChecked((current) => {
    const next = new Set(current)
    const allChecked = visible.length > 0 && visibleChecked === visible.length
    visible.forEach((line) => (allChecked ? next.delete(line.lotId) : next.add(line.lotId)))
    return next
  })

  const removeLot = (lotId) => {
    const next = new Set(values.lotIds)
    next.delete(lotId)
    onChange({ lotIds: next })
  }

  const applyToSelected = () => {
    const defaults = { scope: values.defaultScope, amount: values.defaultAmount }
    let next = values.lineOverrides
    if (bulk.amount !== '') {
      next = setLineOverride(next, selectedIds, 'amount', settlePriceText(bulk.amount), defaults)
    }
    if (bulk.scope.trim() !== '') {
      next = setLineOverride(next, selectedIds, 'scope', bulk.scope, defaults)
    }
    setOverrides(dropAmountsEqualToDefault(next, values.defaultAmount))
    setBulk({ amount: '', scope: '' })
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Every lot is a line of this order: what you write here goes to all of them, and a row
        can be changed to give that lot something different. It is charged as its own order and
        does not change the prices the Job already has.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 200px' },
          alignItems: 'start',
          mb: 2.5,
        }}
      >
        <Field label="Scope of Work (every lot)">
          <TextField
            fullWidth
            multiline
            minRows={2}
            size="small"
            placeholder="What is done, and why"
            value={values.defaultScope}
            onChange={(event) => onChange({ defaultScope: event.target.value })}
            slotProps={{ htmlInput: { 'aria-label': 'Scope of Work for every lot' } }}
          />
        </Field>
        <Field label="Amount per Lot">
          <TextField
            fullWidth
            size="small"
            placeholder="0.00"
            value={values.defaultAmount}
            onChange={(event) => onChange({ defaultAmount: sanitizePriceInput(event.target.value) })}
            onBlur={() => {
              const settled = settlePriceText(values.defaultAmount)
              if (settled !== values.defaultAmount) onChange({ defaultAmount: settled })
            }}
            slotProps={{
              input: dollarAdornment,
              htmlInput: { 'aria-label': 'Amount per Lot' },
            }}
          />
        </Field>
      </Box>

      {lines.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Choose the Job and its coverage above: each lot it reaches shows up here as a line.
        </Typography>
      ) : (
        <>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { md: 'center' }, mb: 1.5 }}
          >
            <TextField
              size="small"
              placeholder="Search phase, building, lot or plan type..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ flex: { md: '0 1 360px' } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
                htmlInput: { 'aria-label': 'Search lines' },
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: { md: 'auto' } }}>
              Highlighted values belong to that lot only.
            </Typography>
          </Stack>

          {selectedIds.length > 0 && (
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={1.5}
              sx={{
                alignItems: { lg: 'center' },
                p: 1.5,
                mb: 1.5,
                borderRadius: 1.5,
                bgcolor: 'action.selected',
              }}
            >
              <Typography variant="body2" fontWeight={700} sx={{ whiteSpace: 'nowrap' }}>
                {plural(selectedIds.length, 'lot')} selected
              </Typography>
              <TextField
                size="small"
                placeholder="Amount"
                value={bulk.amount}
                onChange={(event) => setBulk((current) => ({
                  ...current,
                  amount: sanitizePriceInput(event.target.value),
                }))}
                sx={{ width: { lg: 130 } }}
                slotProps={{
                  input: dollarAdornment,
                  htmlInput: { 'aria-label': 'Amount for the selected lots' },
                }}
              />
              <TextField
                size="small"
                placeholder="Scope of Work"
                value={bulk.scope}
                onChange={(event) => setBulk((current) => ({ ...current, scope: event.target.value }))}
                sx={{ flex: 1 }}
                slotProps={{ htmlInput: { 'aria-label': 'Scope of Work for the selected lots' } }}
              />
              <Button
                variant="contained"
                size="small"
                disableElevation
                disabled={bulk.amount === '' && bulk.scope.trim() === ''}
                onClick={applyToSelected}
              >
                Apply to selected
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                onClick={() => setOverrides(clearLineOverrides(values.lineOverrides, selectedIds))}
              >
                Use defaults
              </Button>
              <Button color="inherit" size="small" onClick={() => setChecked(new Set())}>
                Clear selection
              </Button>
            </Stack>
          )}

          <Box
            sx={{
              maxHeight: 520,
              overflow: 'auto',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
            }}
          >
            <Table size="small" stickyHeader aria-label="Order lines" sx={{ minWidth: 700 }}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={visible.length > 0 && visibleChecked === visible.length}
                      indeterminate={visibleChecked > 0 && visibleChecked < visible.length}
                      onChange={toggleVisible}
                      slotProps={{ input: { 'aria-label': 'Select all lines' } }}
                    />
                  </TableCell>
                  <TableCell sx={{ width: 240 }}>Lot</TableCell>
                  <TableCell sx={{ minWidth: 300 }}>Scope of Work</TableCell>
                  <TableCell sx={{ width: 140 }}>Amount</TableCell>
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        Nothing matches the search.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {visible.map((line) => (
                  <TableRow key={line.lotId} hover selected={checked.has(line.lotId)}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={checked.has(line.lotId)}
                        onChange={() => toggleLot(line.lotId)}
                        slotProps={{ input: { 'aria-label': `Select lot ${line.lot}` } }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Typography variant="body2" fontWeight={700}>Lot {line.lot}</Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        {[
                          line.phase,
                          line.building,
                          line.plan && `Plan ${line.plan}`,
                        ].filter(Boolean).join(', ') || 'No phase'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <TextField
                        fullWidth
                        multiline
                        minRows={1}
                        maxRows={4}
                        size="small"
                        placeholder="Scope of Work"
                        value={line.scope}
                        onChange={(event) => setOwn([line.lotId], 'scope', event.target.value)}
                        sx={line.ownScope ? ownValueSx : undefined}
                        slotProps={{ htmlInput: { 'aria-label': `Scope of Work, lot ${line.lot}` } }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="0.00"
                        value={line.amountText}
                        onChange={(event) => setOwn(
                          [line.lotId],
                          'amount',
                          sanitizePriceInput(event.target.value),
                        )}
                        onBlur={settleAmounts}
                        sx={line.ownAmount ? ownValueSx : undefined}
                        slotProps={{
                          input: dollarAdornment,
                          htmlInput: { 'aria-label': `Amount, lot ${line.lot}` },
                        }}
                      />
                    </TableCell>
                    <TableCell padding="checkbox" sx={{ whiteSpace: 'nowrap' }}>
                      {(line.ownScope || line.ownAmount) && (
                        <Tooltip title="Use the default values">
                          <IconButton
                            size="small"
                            aria-label={`Use the default values for lot ${line.lot}`}
                            onClick={() => setOverrides(clearLineOverrides(values.lineOverrides, [line.lotId]))}
                          >
                            <RestartAltRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {values.coverageMode === 'lots' && (
                        <Tooltip title="Take the lot off the order">
                          <IconButton
                            size="small"
                            aria-label={`Remove lot ${line.lot}`}
                            onClick={() => removeLot(line.lotId)}
                          >
                            <DeleteOutlineRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </>
      )}

      <ChangeOrderPlaceLines
        places={values.placeLines}
        canAdd={Boolean(job)}
        onChange={(placeLines) => onChange({ placeLines })}
      />

    </Box>
  )
}
