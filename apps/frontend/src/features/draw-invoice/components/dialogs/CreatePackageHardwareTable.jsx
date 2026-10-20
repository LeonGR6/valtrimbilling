import {
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
import { hardwareChargeKey } from '../../utils/drawPackages.js'

export default function CreatePackageHardwareTable({
  summary,
  billedHardwareCharges,
  onToggle,
}) {
  const hardwareRows = summary.hardwareRows ?? []

  if (
    !summary.separateHardwarePrice
  ) return null
  const selectedCount = hardwareRows.filter((row) => row.chargeHardware).length

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2, bgcolor: 'action.hover' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography fontWeight={800}>Hardware</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Every available Lot is listed. Upcoming Calendar portions are
              preselected; any other portion can be selected manually.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={`${selectedCount} selected`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Total · ${formatCurrency(summary.hardwareTotal)}`}
            />
          </Stack>
        </Stack>
      </Box>
      <Divider />
      {hardwareRows.length === 0 && (
        <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            There are no configured Separate Hardware allocations for these Lots.
          </Typography>
        </Box>
      )}
      {hardwareRows.length > 0 && (
        <TableContainer>
          <Table size="small" aria-label="Choose separate hardware charges">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">Charge</TableCell>
                <TableCell>Phase</TableCell>
                <TableCell>Lot</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>Billing trigger</TableCell>
                <TableCell>Allocation</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {hardwareRows.map((hardware) => {
                const billed = billedHardwareCharges.get(hardwareChargeKey(
                  hardware.lotId,
                  hardware.hardwareBillingMode,
                  hardware.hardwareEventType,
                ))
                return (
                  <TableRow key={hardware.selectionKey} hover>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={hardware.chargeHardware}
                        disabled={Boolean(billed)}
                        onChange={() => onToggle(hardware)}
                        inputProps={{
                          'aria-label': `Charge Hardware for Lot ${hardware.lotNumber} from ${hardware.hardwareEventType ?? `Draw ${hardware.drawIndex + 1}`}`,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {formatPhaseBuilding(hardware.phaseCode, hardware.building, { separator: ' / ' })}
                    </TableCell>
                    <TableCell>
                      <Typography color="error.main" fontWeight={850}>
                        {hardware.lotNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>{hardware.planCode ?? '—'}</TableCell>
                    <TableCell>
                      <Typography fontWeight={750}>
                        {hardware.hardwareBillingMode === 'BY_EVENT'
                          ? hardware.isCalendarSuggested
                            ? `${hardware.hardwareEventType} Calendar event · Suggested`
                            : `${hardware.hardwareEventType} · Manual selection`
                          : `Draw #${hardware.drawIndex + 1}${hardware.drawName?.trim()
                            ? ` · ${hardware.drawName.trim()}`
                            : ''}`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {hardware.hardwareBillingMode === 'BY_EVENT'
                        ? `${hardware.hardwareEventType} · ${hardware.hardwarePercentage}%`
                        : '100% full'}
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight={750}>
                        {formatCurrency(hardware.hardwareAmount)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {billed ? (
                        <Chip
                          size="small"
                          color="default"
                          label={`Already billed · ${billed.packageNumber}`}
                        />
                      ) : hardware.chargeHardware ? (
                        <Chip size="small" color="success" label="Will be charged" />
                      ) : (
                        <Chip size="small" variant="outlined" label="Not charged" />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography fontWeight={850}>Hardware total</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={900}>
                    {formatCurrency(summary.hardwareTotal)}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </TableContainer>
      )}
    </Card>
  )
}
