import { Chip, Tooltip } from '@mui/material'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { describeBacking } from '../services/purchaseOrderRecord.js'

/**
 * Says whether a Purchase Order backs an option a Package bills. It only informs:
 * it never changes or blocks the Package.
 */
export default function PurchaseOrderBackingChip({ result }) {
  const info = describeBacking(result)
  if (!info) return null

  const hint = result.state === 'price_differs'
    ? `${info.hint} The PDF prints ${formatCurrency(result.poPrice)}.`
    : info.hint

  return (
    <Tooltip title={hint}>
      <Chip size="small" color={info.color} variant={info.variant} label={info.label} />
    </Tooltip>
  )
}
