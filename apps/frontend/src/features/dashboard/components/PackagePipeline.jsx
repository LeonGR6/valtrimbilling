import { Link as RouterLink } from 'react-router-dom'
import { Box, Link, Skeleton, Typography } from '@mui/material'
import {
  DRAW_PACKAGE_STATUSES, DRAW_PACKAGE_STATUS_LABELS,
} from '../../draw-invoice/services/drawInvoicePackageRecord.js'
import SegmentedBar from './SegmentedBar.jsx'

const STATUS_COLORS = {
  DRAFT: 'text.disabled',
  AWAITING_PAYMENT: 'primary.main',
  PAID_CLOSED: 'success.main',
}

export default function PackagePipeline({ statusCounts, loading }) {
  const rows = DRAW_PACKAGE_STATUSES.map((status) => ({
    status,
    label: DRAW_PACKAGE_STATUS_LABELS[status],
    value: statusCounts[status] ?? 0,
    color: STATUS_COLORS[status],
  }))
  const total = rows.reduce((sum, row) => sum + row.value, 0)

  return (
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>Packages</Typography>
      <Typography variant="body2" color="text.secondary">
        {total === 0
          ? 'No Draw & Invoice Packages yet'
          : `${total} Draw & Invoice ${total === 1 ? 'Package' : 'Packages'}, by status`}
      </Typography>

      {loading ? (
        <Skeleton variant="rounded" height={88} sx={{ mt: 2 }} />
      ) : (
        <>
          <Box sx={{ mt: 2 }}>
            <SegmentedBar
              label={rows.map((row) => `${row.label} ${row.value}`).join(', ')}
              segments={rows.map((row) => ({ key: row.status, color: row.color, value: row.value }))}
            />
          </Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 1.75, p: 0, display: 'grid', gap: 1 }}>
            {rows.map((row) => (
              <Box
                component="li" key={row.status}
                sx={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 1.25, alignItems: 'baseline' }}
              >
                <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: row.color, alignSelf: 'center' }} />
                <Link component={RouterLink} to="/draw-invoice" underline="hover" color="text.primary" variant="body2">
                  {row.label}
                </Link>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.value}</Typography>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  )
}
