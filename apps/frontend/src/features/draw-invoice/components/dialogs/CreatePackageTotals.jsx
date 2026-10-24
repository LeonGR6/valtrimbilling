import { Box, Typography } from '@mui/material'
import { formatCurrency, formatPercentage } from '../../utils/drawInvoiceFormatters.js'

function AmountRow({ label, value, deduction = false, strong = false, divided = false }) {
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
        {deduction ? `-${formatCurrency(value)}` : formatCurrency(value)}
      </Typography>
    </>
  )
}

/**
 * What the Package will bill: the gross amount, what the Builder deducts from
 * it (Retention and OCIP / WRAP insurance, only when the setup has them) and
 * the net amount the invoice will be for.
 */
export default function CreatePackageTotals({ summary, schedule }) {
  const hasRetention = summary.retention > 0 || Boolean(schedule?.retentionEnabled)
  const hasWrap = summary.wrapInsurance > 0 || Boolean(schedule?.ocipWrapEnabled)

  return (
    <Box
      sx={{
        mt: 1.5, display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 3, rowGap: 0.75,
        width: '100%', maxWidth: 380, ml: { sm: 'auto' },
      }}
    >
      <AmountRow label="Gross amount" value={summary.grossAmount} />
      {hasRetention && (
        <AmountRow
          label={schedule?.retentionEnabled
            ? `Retention (${formatPercentage(schedule.retentionPercentage)}%)`
            : 'Retention'}
          value={summary.retention}
          deduction
        />
      )}
      {hasWrap && (
        <AmountRow
          label={schedule?.ocipWrapEnabled
            ? `OCIP / WRAP insurance (${formatPercentage(schedule.ocipWrapPercentage)}%)`
            : 'OCIP / WRAP insurance'}
          value={summary.wrapInsurance}
          deduction
        />
      )}
      <AmountRow
        label="Net amount"
        value={summary.invoiceAmount}
        strong
        divided={hasRetention || hasWrap}
      />
    </Box>
  )
}
