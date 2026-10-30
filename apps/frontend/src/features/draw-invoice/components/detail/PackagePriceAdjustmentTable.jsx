import {
  Card,
  Chip,
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
import {
  differenceComponents,
  formatSignedMoney,
} from '../../../plan-pricing/utils/priceDifferences.js'
import { TableCardHeader } from '../shared/PackageUi.jsx'
import { packageTableSx } from '../shared/packageTableStyles.js'

function lineLabel(line) {
  return line.kind === 'HARDWARE_EVENT'
    ? `Hardware ${line.hardwareEventType}`
    : `Draw ${line.drawNumber}`
}

/**
 * The price differences a Price Adjustment Package invoices, one line each: where
 * the difference comes from (the Package that billed it), what changed, and the
 * amounts with Retention and WRAP. A negative amount is a credit inside an
 * adjustment that adds up to a positive total.
 */
export default function PackagePriceAdjustmentTable({
  adjustment,
  title = 'Price differences',
  description = 'What the same Draws would have billed at the new price of their Phases, minus what the source Packages billed.',
  totalLabel = 'Total of this adjustment',
}) {
  const lines = adjustment?.lines ?? []

  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableCardHeader
        title={title}
        description={description}
        chip={<Chip size="small" variant="outlined" label={`${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`} />}
      />
      <TableContainer>
        <Table size="small" aria-label={`${title} in this Package`} sx={packageTableSx}>
          <TableHead>
            <TableRow>
              <TableCell>Source Package</TableCell>
              <TableCell>Phase</TableCell>
              <TableCell>Lot</TableCell>
              <TableCell>Line</TableCell>
              <TableCell>What changed</TableCell>
              <TableCell align="right">Gross</TableCell>
              <TableCell align="right">Retention</TableCell>
              <TableCell align="right">WRAP</TableCell>
              <TableCell align="right">Net</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id} hover>
                <TableCell><Typography fontWeight={750}>{line.sourcePackageNumber}</Typography></TableCell>
                <TableCell>
                  {formatPhaseBuilding(line.phaseCode, line.building, { separator: ' / ' })}
                </TableCell>
                <TableCell>
                  <Typography color="error.main" fontWeight={850}>{line.lotNumber}</Typography>
                </TableCell>
                <TableCell>{lineLabel(line)}</TableCell>
                <TableCell>
                  {differenceComponents(line)
                    .map(([name, amount]) => `${name} ${formatSignedMoney(amount)}`)
                    .join(', ') || '—'}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatSignedMoney(line.gross)}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatSignedMoney(line.retention)}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatSignedMoney(line.wrap)}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 750 }}>
                  {formatSignedMoney(line.net)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5}>
                <Typography fontWeight={850}>{totalLabel}</Typography>
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>
                {formatSignedMoney(adjustment?.grossAmount ?? 0)}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>
                {formatSignedMoney(adjustment?.retentionAmount ?? 0)}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>
                {formatSignedMoney(adjustment?.wrapAmount ?? 0)}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>
                {formatSignedMoney(adjustment?.netAmount ?? 0)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </Card>
  )
}
