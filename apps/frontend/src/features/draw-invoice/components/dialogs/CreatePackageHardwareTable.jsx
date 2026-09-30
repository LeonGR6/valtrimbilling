import {
  Box,
  Card,
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
import {
  formatBuilding,
  formatPhase,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'

export default function CreatePackageHardwareTable({ summary }) {
  const hardwareRows = summary.hardwareRows ?? []

  if (!summary.separateHardwarePrice || !summary.hardwareIsDue) return null

  const billingDrawLabel = summary.hardwareBillingDrawIndex == null
    ? 'Configured draw'
    : `Draw #${summary.hardwareBillingDrawIndex + 1}`

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
              Separate hardware prices will be included automatically with the
              selected hardware billing draw.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={`${hardwareRows.length} ${hardwareRows.length === 1 ? 'lot' : 'lots'}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Charge with · ${billingDrawLabel}`}
            />
          </Stack>
        </Stack>
      </Box>
      <Divider />
      <TableContainer>
        <Table size="small" aria-label="Separate hardware to charge in this package">
          <TableHead>
            <TableRow>
              <TableCell>Phase</TableCell>
              <TableCell>Lot</TableCell>
              <TableCell>Plan</TableCell>
              <TableCell>Charged with</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {hardwareRows.map((hardware) => (
              <TableRow
                key={`${hardware.phaseId}:${hardware.lotId}:${hardware.drawIndex}`}
                hover
              >
                <TableCell>
                  {formatPhase(hardware.phaseCode)} / {formatBuilding(hardware.building)}
                </TableCell>
                <TableCell>
                  <Typography color="error.main" fontWeight={850}>
                    {hardware.lotNumber}
                  </Typography>
                </TableCell>
                <TableCell>{hardware.planCode ?? '—'}</TableCell>
                <TableCell>
                  <Typography fontWeight={750}>
                    Draw #{hardware.drawIndex + 1}
                    {hardware.drawName?.trim() ? ` · ${hardware.drawName.trim()}` : ''}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight={750}>
                    {formatCurrency(hardware.hardwareAmount)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip size="small" color="success" label="Included in package" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>
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
    </Card>
  )
}
