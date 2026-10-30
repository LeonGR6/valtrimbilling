import { Link as RouterLink } from 'react-router-dom'
import { Box, Link, Skeleton, Typography } from '@mui/material'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { pluralize } from '../utils/dashboardDates.js'
import SegmentedBar from './SegmentedBar.jsx'

const BUCKETS = [
  { key: 'overdue', label: 'Overdue', color: 'urgency.late' },
  { key: 'dueSoon', label: 'Due this week', color: 'urgency.soon' },
  { key: 'notDue', label: 'Not yet due', color: 'text.disabled' },
]

export default function CollectionSummary({ pendingBalance, aging, loading }) {
  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>Pending collection</Typography>
      <Typography variant="body2" color="text.secondary">Unpaid balance of issued invoices</Typography>

      {loading ? (
        <Skeleton variant="rounded" height={104} sx={{ mt: 2 }} />
      ) : (
        <>
          <Typography
            component="p"
            sx={{ fontWeight: 700, fontSize: 38, lineHeight: 1.1, letterSpacing: '-0.025em', mt: 1.75, mb: 1.75 }}
          >
            {formatCurrency(pendingBalance)}
          </Typography>
          <SegmentedBar
            label={BUCKETS.map(({ key, label }) => (
              `${label} ${formatCurrency(aging[key].balance)}`
            )).join('. ')}
            segments={BUCKETS.map(({ key, color }) => ({
              key, color, value: aging[key].balance,
            }))}
          />
          <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 1.75, p: 0, display: 'grid', gap: 1 }}>
            {BUCKETS.map(({ key, label, color }) => (
              <Box
                component="li" key={key}
                sx={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 1.25, alignItems: 'baseline' }}
              >
                <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: color, alignSelf: 'center' }} />
                <Link component={RouterLink} to="/draw-invoice" underline="hover" color="text.primary" variant="body2">
                  {label}{' '}
                  <Typography component="span" variant="body2" color="text.secondary">
                    {pluralize(aging[key].count, 'invoice')}
                  </Typography>
                </Link>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(aging[key].balance)}</Typography>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  )
}
