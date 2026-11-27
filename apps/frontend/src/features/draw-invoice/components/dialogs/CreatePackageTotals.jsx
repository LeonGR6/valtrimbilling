import { Box, Typography } from '@mui/material'
import { formatCurrency, formatPercentage } from '../../utils/drawInvoiceFormatters.js'
import { formatSignedMoney } from '../../../plan-pricing/utils/priceDifferences.js'

function AmountRow({
  label,
  value,
  deduction = false,
  signed = false,
  strong = false,
  divided = false,
}) {
  return (
    <>
      {divided && <Box sx={{ gridColumn: '1 / -1', borderTop: 1, borderColor: 'divider' }} />}
      <Typography
        variant={strong ? 'body1' : 'body2'}
        color={strong ? 'text.primary' : 'text.secondary'}
        sx={{ fontWeight: strong ? 700 : 400 }}
      >
        {label}
      </Typography>
      <Typography
        variant={strong ? 'body1' : 'body2'}
        sx={{ textAlign: 'right', fontWeight: strong ? 700 : 500 }}
      >
        {signed
          ? formatSignedMoney(value)
          : deduction ? `-${formatCurrency(value)}` : formatCurrency(value)}
      </Typography>
    </>
  )
}

/**
 * What the Package will bill: the gross amount, what the Builder deducts from
 * it (Retention and OCIP / WRAP insurance, only when the setup has them) and
 * the net amount the invoice will be for. `priceChanges` are the totals of the pending price
 * differences chosen to be collected with it: their rows add to the gross amount, and the Retention
 * and WRAP they withheld to what is deducted.
 */
export default function CreatePackageTotals({ summary, schedule, priceChanges = null }) {
  const changes = priceChanges?.count > 0 ? priceChanges : null
  const retention = (Number(summary.retention) || 0) + (changes?.retention ?? 0)
  const wrapInsurance = (Number(summary.wrapInsurance) || 0) + (changes?.wrap ?? 0)
  const hasRetention = retention > 0 || Boolean(schedule?.retentionEnabled)
  const hasWrap = wrapInsurance > 0 || Boolean(schedule?.ocipWrapEnabled)

  return (
    <Box
      sx={{
        mt: 1.5, display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 3, rowGap: 0.75,
        width: '100%', maxWidth: 380, ml: { sm: 'auto' },
      }}
    >
      <AmountRow label="Gross amount" value={summary.grossAmount} />
      {changes && <AmountRow label="Price changes" value={changes.gross} signed />}
      {hasRetention && (
        <AmountRow
          label={schedule?.retentionEnabled
            ? `Retention (${formatPercentage(schedule.retentionPercentage)}%)`
            : 'Retention'}
          value={retention}
          deduction
        />
      )}
      {hasWrap && (
        <AmountRow
          label={schedule?.ocipWrapEnabled
            ? `OCIP / WRAP insurance (${formatPercentage(schedule.ocipWrapPercentage)}%)`
            : 'OCIP / WRAP insurance'}
          value={wrapInsurance}
          deduction
        />
      )}
      <AmountRow
        label="Net amount"
        value={Math.round(((Number(summary.invoiceAmount) || 0) + (changes?.net ?? 0)) * 100) / 100}
        strong
        divided={hasRetention || hasWrap}
      />
    </Box>
  )
}
