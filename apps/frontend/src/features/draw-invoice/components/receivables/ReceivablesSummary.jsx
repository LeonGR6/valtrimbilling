import { Box, ButtonBase, Typography } from '@mui/material'
import { AGING_BUCKETS } from '../../utils/receivablesAging.js'
import { BUCKET_COLORS, formatCents } from './receivablesView.js'

function SummaryCard({ label, amount, caption, color, selected, onSelect }) {
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Show ${label}: ${amount}`}
      sx={{
        display: 'block',
        minWidth: 0,
        width: '100%',
        px: 1.5,
        py: 1.1,
        textAlign: 'left',
        border: 1,
        borderColor: selected ? color : 'divider',
        borderLeftWidth: 4,
        borderLeftColor: color,
        borderRadius: 2,
        bgcolor: 'background.paper',
        boxShadow: selected ? (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}` : 'none',
        transition: 'border-color 120ms, background-color 120ms',
        '&:hover': { bgcolor: 'action.hover' },
        '&.Mui-focusVisible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
      }}
    >
      <Typography variant="body2" fontWeight={750} color="text.secondary" noWrap>
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={850} sx={{ lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }} noWrap>
        {amount}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {caption}
      </Typography>
    </ButtonBase>
  )
}

const countLabel = (count) => (count === 1 ? '1 invoice' : `${count} invoices`)

/**
 * What is owed in each bucket, and in all. Choosing a bucket narrows the table to
 * the invoices that make that amount; choosing it again (or Total) lifts it.
 */
export default function ReceivablesSummary({ totals, invoices, bucket, onSelectBucket }) {
  const counts = Object.fromEntries(AGING_BUCKETS.map(({ key }) => [key, 0]))
  for (const invoice of invoices) counts[invoice.bucket] += 1

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: 1.5,
      }}
    >
      <SummaryCard
        label="Total Due"
        amount={formatCents(totals.totalCents)}
        caption={countLabel(totals.invoiceCount)}
        color="primary.main"
        selected={bucket === 'ALL'}
        onSelect={() => onSelectBucket('ALL')}
      />
      {AGING_BUCKETS.map(({ key, label }) => (
        <SummaryCard
          key={key}
          label={label}
          amount={formatCents(totals.buckets[key])}
          caption={countLabel(counts[key])}
          color={BUCKET_COLORS[key]}
          selected={bucket === key}
          onSelect={() => onSelectBucket(bucket === key ? 'ALL' : key)}
        />
      ))}
    </Box>
  )
}
