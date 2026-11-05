import { useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  InputAdornment,
  Paper,
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

import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useChangeOrderCoverage } from '../hooks/useChangeOrderCoverage.js'
import { filterCoverageRows } from '../utils/coverage.js'
import {
  clearLineOverrides,
  dropAmountsEqualToDefault,
  sanitizePriceInput,
  setLineOverride,
} from '../utils/pricing.js'
import Field from './ChangeOrderField.jsx'
import ChangeOrderPlaceLines from './ChangeOrderPlaceLines.jsx'

// A value the Lot has of its own, not the default one.
const ownValueSx = { '& .MuiOutlinedInput-root': { bgcolor: 'primary.light' } }

const dollarAdornment = { startAdornment: <InputAdornment position="start">$</InputAdornment> }

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

/** "3 lots · 2 lines without a lot · 1 with their own values · 1 without an amount" */
function countsText(amounts) {
  const withoutAmount = amounts.unpriced + amounts.places.unpriced
  return [
    amounts.lots > 0 && plural(amounts.lots, 'lot'),
    amounts.places.count > 0 && `${plural(amounts.places.count, 'line')} without a lot`,
    amounts.own > 0 && `${amounts.own} with their own values`,
    withoutAmount > 0 && `${withoutAmount} without an amount`,
  ].filter(Boolean).join(' · ')
}

/**
 * Every Lot the coverage reaches is a line of the order. The default Scope of
 * Work and Amount go to all of them; a line can be given its own, one by one
 * or for the Lots ticked in the table. Work that is not on a Lot (the Sales
 * Office) is added below as a line without a Lot.
 */
export default function ChangeOrderLinesCard({ values, onChange }) {
  const { job, lines, amounts } = useChangeOrderCoverage(values)
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
  // "1689.6" typed over a default of "1689.60" is the same price, not a value of its own.
  const settleAmounts = () => {
    const settled = dropAmountsEqualToDefault(values.lineOverrides, values.defaultAmount)
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
      next = setLineOverride(next, selectedIds, 'amount', bulk.amount, defaults)
    }
    if (bulk.scope.trim() !== '') {
      next = setLineOverride(next, selectedIds, 'scope', bulk.scope, defaults)
    }
    setOverrides(dropAmountsEqualToDefault(next, values.defaultAmount))
    setBulk({ amount: '', scope: '' })
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        Scope of Work &amp; Amount
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every lot is a line of this order. What you type here goes to all of them; change a row
        to give that lot something different. Charged as its own order: it does not change the
        prices the Job already has.
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
            <Table size="small" stickyHeader aria-label="Order lines" sx={{ minWidth: 820 }}>
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
                  <TableCell>Phase</TableCell>
                  <TableCell>Building</TableCell>
                  <TableCell>Lot</TableCell>
                  <TableCell>Plan Type</TableCell>
                  <TableCell sx={{ minWidth: 260 }}>Scope of Work</TableCell>
                  <TableCell sx={{ width: 140 }}>Amount</TableCell>
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
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
                    <TableCell>{line.phase}</TableCell>
                    <TableCell>{line.building || '—'}</TableCell>
                    <TableCell>{line.lot}</TableCell>
                    <TableCell>{line.plan ? `Plan ${line.plan}` : '—'}</TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <TextField
                        fullWidth
                        multiline
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

      {(lines.length > 0 || values.placeLines.length > 0) && (
        <Stack
          direction="row"
          spacing={2}
          aria-live="polite"
          sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 2 }}
        >
          <Typography variant="body2" color="text.secondary">
            {countsText(amounts)}
          </Typography>
          <Typography
            variant="subtitle1"
            fontWeight={800}
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            Total {formatCurrency(amounts.total ?? 0)}
          </Typography>
        </Stack>
      )}
    </Paper>
  )
}
