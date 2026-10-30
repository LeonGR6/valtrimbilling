import { Alert, AlertTitle, Box } from '@mui/material'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'
import { describeUnbackedOption } from '../../utils/packagePurchaseOrders.js'

const LISTED = 6

/**
 * Says which options a Package charges that no Purchase Order backs well: another price, not
 * printed in the Lot's PO, or no PO for the Lot. It only informs; the Package is never blocked.
 */
export default function PackagePurchaseOrderWarning({ unbacked, sx }) {
  if (!unbacked || unbacked.length === 0) return null

  // Only "no PO for this Lot" is not a mismatch, so it is a quieter notice.
  const needsLook = unbacked.some(({ state }) => state !== 'no_po')
  const count = unbacked.length

  return (
    <Alert severity={needsLook ? 'warning' : 'info'} sx={sx}>
      <AlertTitle sx={{ fontWeight: 800 }}>
        {count === 1
          ? 'An option in this Package is not backed by a Purchase Order'
          : `${count} options in this Package are not backed by a Purchase Order`}
      </AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {unbacked.slice(0, LISTED).map((item) => (
          <li key={`${item.row.lotId}:${item.row.optionId ?? item.row.optionCode}`}>
            {describeUnbackedOption(item, formatCurrency)}
          </li>
        ))}
        {count > LISTED && <li>and {count - LISTED} more.</li>}
      </Box>
    </Alert>
  )
}
