import {
  Alert,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { formatPhaseBuilding } from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import { useChangeOrderLines } from '../hooks/useChangeOrderData.js'

const money = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

/**
 * The lines of one Extra / CO, read when shown: a Lot line with its Phase / Building and Plan, a line
 * without a Lot with its place. Used where the Extra / CO page itself may not open (Draw & Invoice).
 */
export default function ChangeOrderLinesTable({ changeOrderId, number }) {
  const { lines, loading, error } = useChangeOrderLines(changeOrderId)

  if (loading) return <Skeleton variant="rounded" height={64} />
  if (error) return <Alert severity="error">{error}</Alert>
  if (lines.length === 0) {
    return <Typography variant="body2" color="text.secondary">It has no lines left.</Typography>
  }

  return (
    <Table size="small" aria-label={`Lines of ${number}`} sx={{ minWidth: 560, bgcolor: 'background.paper' }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ width: 220 }}>Lot / place</TableCell>
          <TableCell sx={{ width: 140 }}>Plan</TableCell>
          <TableCell>Scope of Work</TableCell>
          <TableCell align="right" sx={{ width: 120 }}>Amount</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.id}>
            <TableCell>
              {line.isPlace ? (
                <Typography variant="body2" fontWeight={700}>{line.location}</Typography>
              ) : (
                <>
                  <Typography variant="body2" fontWeight={700}>Lot {line.lot}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {formatPhaseBuilding(line.phase, line.building)}
                  </Typography>
                </>
              )}
            </TableCell>
            <TableCell>
              {line.plan ? `Plan ${line.plan}` : ''}
              {line.planName && (
                <Typography variant="caption" color="text.secondary" component="div">{line.planName}</Typography>
              )}
            </TableCell>
            <TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{line.scope}</TableCell>
            <TableCell align="right" sx={money}>{formatCurrency(line.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
