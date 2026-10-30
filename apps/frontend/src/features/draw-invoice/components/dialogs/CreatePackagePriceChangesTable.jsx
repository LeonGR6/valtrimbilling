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
import { formatPhaseBuilding } from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'
import { priceChangeLabel } from '../../utils/priceChanges.js'
import { formatSignedMoney } from '../../../plan-pricing/utils/priceDifferences.js'

// A credit lowers what the Builder pays, a charge raises it.
const amountColor = (value) => (value < 0 ? 'error.main' : value > 0 ? 'success.main' : 'text.secondary')

function SignedAmount({ value, strong = false }) {
  return (
    <Typography
      component="span"
      color={amountColor(value)}
      fontWeight={strong ? 900 : 750}
      sx={{ whiteSpace: 'nowrap' }}
    >
      {formatSignedMoney(value)}
    </Typography>
  )
}

/**
 * The price changes of the Phases in the Package: Packages that were already invoiced keep what they
 * billed, and the Phase changed price afterwards. Each one checked goes on this Package's invoice as a
 * row of its own. Nothing is checked until it is chosen.
 */
export default function CreatePackagePriceChangesTable({
  rows,
  selectedIds,
  totals,
  issue = null,
  onToggle,
  onSetIncluded,
}) {
  const selected = new Set(selectedIds)
  const checkedCount = rows.filter((row) => selected.has(row.id)).length
  const allChecked = rows.length > 0 && checkedCount === rows.length
  // Retention and WRAP only take columns when some change moves them.
  const hasRetention = rows.some((row) => row.retention !== 0)
  const hasWrap = rows.some((row) => row.wrap !== 0)
  const showNet = hasRetention || hasWrap

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2, bgcolor: 'action.hover' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography fontWeight={800}>Change Price</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              These Phases changed price after their Packages were invoiced, and an invoice keeps what
              it billed. Check the ones to charge in this Package: each goes on the invoice as a row of
              its own, and it is not collected again.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              size="small"
              color={checkedCount > 0 ? 'primary' : 'default'}
              variant={checkedCount > 0 ? 'filled' : 'outlined'}
              label={`${checkedCount}/${rows.length} selected`}
            />
            {checkedCount > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={`Net ${formatSignedMoney(totals.net)}`}
              />
            )}
          </Stack>
        </Stack>
      </Box>
      <Divider />

      <TableContainer>
        <Table size="small" aria-label="Price changes to charge in this package">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ whiteSpace: 'nowrap', pr: 1.5 }}>
                <Stack direction="row" sx={{ alignItems: 'center' }}>
                  <Checkbox
                    size="small"
                    checked={allChecked}
                    indeterminate={checkedCount > 0 && !allChecked}
                    onChange={() => onSetIncluded(rows, !allChecked)}
                    slotProps={{
                      input: {
                        'aria-label': allChecked
                          ? 'Exclude all price changes'
                          : 'Include all price changes',
                      },
                    }}
                  />
                  Include
                </Stack>
              </TableCell>
              <TableCell>Phase</TableCell>
              <TableCell>Lot</TableCell>
              <TableCell>Plan</TableCell>
              <TableCell>Billed on</TableCell>
              <TableCell align="right">Billed</TableCell>
              <TableCell align="right">New price</TableCell>
              <TableCell align="right">Difference</TableCell>
              {hasRetention && <TableCell align="right">Retention</TableCell>}
              {hasWrap && <TableCell align="right">WRAP</TableCell>}
              {showNet && <TableCell align="right">Net</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const included = selected.has(row.id)

              return (
                <TableRow key={row.id} hover selected={included}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={included}
                      onChange={() => onToggle(row)}
                      inputProps={{
                        'aria-label': `${included ? 'Exclude' : 'Include'} the price change of lot ${row.lotNumber}, ${priceChangeLabel(row)}`,
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    {formatPhaseBuilding(row.phaseCode, row.building, { separator: ' / ' })}
                  </TableCell>
                  <TableCell>
                    <Typography color="error.main" fontWeight={850}>{row.lotNumber}</Typography>
                  </TableCell>
                  <TableCell>{row.planCode ?? '—'}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={750}>{row.packageNumber}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {priceChangeLabel(row)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{formatCurrency(row.billedGross)}</TableCell>
                  <TableCell align="right">{formatCurrency(row.newGross)}</TableCell>
                  <TableCell align="right"><SignedAmount value={row.gross} /></TableCell>
                  {hasRetention && (
                    <TableCell align="right"><SignedAmount value={-row.retention} /></TableCell>
                  )}
                  {hasWrap && (
                    <TableCell align="right"><SignedAmount value={-row.wrap} /></TableCell>
                  )}
                  {showNet && (
                    <TableCell align="right"><SignedAmount value={row.net} /></TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={7}>
                <Typography fontWeight={850}>Selected price changes total</Typography>
              </TableCell>
              <TableCell align="right">
                <SignedAmount value={totals.gross} strong />
              </TableCell>
              {hasRetention && (
                <TableCell align="right"><SignedAmount value={-totals.retention} strong /></TableCell>
              )}
              {hasWrap && (
                <TableCell align="right"><SignedAmount value={-totals.wrap} strong /></TableCell>
              )}
              {showNet && (
                <TableCell align="right"><SignedAmount value={totals.net} strong /></TableCell>
              )}
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
      {issue && <Alert severity="error" sx={{ m: 2 }}>{issue}</Alert>}
    </Card>
  )
}
