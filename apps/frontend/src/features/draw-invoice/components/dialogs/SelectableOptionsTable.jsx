import {
  Alert,
  Box,
  Card,
  Checkbox,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import PurchaseOrderBackingChip from '../../../purchase-orders/components/PurchaseOrderBackingChip.jsx'
import { countUnbacked } from '../../../purchase-orders/services/purchaseOrderRecord.js'
import { formatPhaseBuilding } from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import { formatCurrency, formatOptionPrice } from '../../utils/drawInvoiceFormatters.js'

export default function SelectableOptionsTable({ summary, onToggle, backing = null }) {
  const availableFromDrawLabel = `Draw #${summary.optionsBillingDrawIndex + 1}`
  const chargeDrawLabel = summary.optionChargeDrawIndex == null
    ? '—'
    : `Draw #${summary.optionChargeDrawIndex + 1}`
  const selectedKeys = new Set(
    summary.selectedOptionRows.map((option) => option.id),
  )
  const pendingOptionCount = summary.availableOptionRows.length
    - summary.billedOptionCount
  // Purchase Orders only inform here: the column and the notice appear when the Job
  // has any, and never stop the Package.
  const showBacking = Boolean(backing?.hasPurchaseOrders)
  const unbackedCount = countUnbacked(backing, summary.selectedOptionRows)

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2, bgcolor: 'action.hover' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography fontWeight={800}>Options</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Pending options from every lot that reached this billing draw are
              selected by default. Previously billed options cannot be selected again.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={`${summary.selectedOptionRows.length}/${pendingOptionCount} pending selected`}
            />
            {summary.billedOptionCount > 0 && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={`${summary.billedOptionCount} already billed`}
              />
            )}
            <Chip
              size="small"
              variant="outlined"
              label={`Available from · ${availableFromDrawLabel}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Charge with · ${chargeDrawLabel}`}
            />
          </Stack>
        </Stack>
      </Box>
      <Divider />

      {showBacking && unbackedCount > 0 && (
        <Alert severity="warning" sx={{ m: 2, mb: 0 }}>
          {unbackedCount === 1
            ? '1 selected option is not backed by a Purchase Order, or its Purchase Order prints another price.'
            : `${unbackedCount} selected options are not backed by a Purchase Order, or their Purchase Orders print another price.`}
          {' '}This only informs: you can still create the package.
        </Alert>
      )}

      {summary.availableOptionRows.length === 0 ? (
        <Alert severity="info" sx={{ m: 2 }}>
          No lot that reached {availableFromDrawLabel} has options to charge.
        </Alert>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Options to charge in this package">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">Include</TableCell>
                <TableCell>Phase</TableCell>
                <TableCell>Lot</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>Option</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Charged with</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell>Status</TableCell>
                {showBacking && <TableCell>Purchase Order</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.availableOptionRows.map((option) => {
                const included = selectedKeys.has(option.id)
                const priceMissing = option.issue === 'PRICE_MISSING'
                const billed = option.isBilled === true

                return (
                  <TableRow
                    key={option.id}
                    hover={!billed}
                    selected={included}
                    sx={billed ? { bgcolor: 'action.disabledBackground' } : undefined}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={billed || included}
                        disabled={billed}
                        onChange={() => !billed && onToggle(option)}
                        inputProps={{
                          'aria-label': billed
                            ? `Option ${option.optionCode} for lot ${option.lotNumber} was already billed`
                            : `${included ? 'Exclude' : 'Include'} option ${option.optionCode} for lot ${option.lotNumber}`,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {formatPhaseBuilding(option.phaseCode, option.building, { separator: ' / ' })}
                    </TableCell>
                    <TableCell>
                      <Typography color="error.main" fontWeight={850}>
                        {option.lotNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>{option.planCode ?? '—'}</TableCell>
                    <TableCell>
                      <Typography fontWeight={750}>{option.optionCode}</Typography>
                    </TableCell>
                    <TableCell>{option.description}</TableCell>
                    <TableCell>
                      {(billed
                        ? option.billingDrawIndex
                        : summary.optionChargeDrawIndex) == null
                        ? '—'
                        : `Draw #${(billed
                            ? option.billingDrawIndex
                            : summary.optionChargeDrawIndex) + 1}`}
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        color={included && priceMissing ? 'error' : 'text.primary'}
                        fontWeight={750}
                      >
                        {billed
                          ? formatOptionPrice(option.billedPrice, option.billedPriceNotApplicable)
                          : (priceMissing
                            ? 'Price missing'
                            : formatOptionPrice(option.price, option.priceNotApplicable))}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={billed || included
                          ? (priceMissing && !billed ? 'error' : 'success')
                          : 'default'}
                        variant={billed || included ? 'filled' : 'outlined'}
                        label={billed
                          ? `Billed · ${option.billedPackageNumber ?? 'previous package'}`
                          : (included
                              ? (priceMissing ? 'Needs price' : 'Included in package')
                              : 'Not included')}
                      />
                    </TableCell>
                    {showBacking && (
                      <TableCell>
                        <PurchaseOrderBackingChip result={backing.lookup(option)} />
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography fontWeight={850}>Selected options total</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={900}>
                    {formatCurrency(summary.optionsTotal)}
                  </Typography>
                </TableCell>
                <TableCell />
                {showBacking && <TableCell />}
              </TableRow>
            </TableFooter>
          </Table>
        </TableContainer>
      )}
    </Card>
  )
}
