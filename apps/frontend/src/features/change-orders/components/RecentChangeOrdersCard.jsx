import { Link as RouterLink } from 'react-router-dom'
import { Box, Link, Paper, Skeleton, Typography } from '@mui/material'

import { formatCurrency, formatDate } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useRecentChangeOrders } from '../hooks/useChangeOrderData.js'
import { changeOrderListDate } from '../services/changeOrderRecord.js'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'

/** The newest Extras / COs, read from the database. */
export default function RecentChangeOrdersCard() {
  const { orders, loading, error } = useRecentChangeOrders(3)

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Recent Extras / COs"
      sx={{ p: 2.5, borderRadius: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="subtitle1" component="h2" fontWeight={700}>
          Recent Extras / COs
        </Typography>
        <Link component={RouterLink} to="/change-orders" variant="body2" underline="hover">
          View all
        </Link>
      </Box>

      {loading && (
        <Box aria-busy="true" aria-label="Loading Extras / COs">
          <Skeleton variant="text" height={36} />
          <Skeleton variant="text" height={36} />
          <Skeleton variant="text" height={36} />
        </Box>
      )}
      {!loading && error && (
        <Typography variant="body2" color="error">{error}</Typography>
      )}
      {!loading && !error && orders.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No Extras / COs yet.
        </Typography>
      )}

      {!loading && !error && orders.length > 0 && (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {orders.map((order) => (
            <Box
              component="li"
              key={order.id}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center',
                columnGap: 1.5,
                py: 1.25,
                borderTop: 1,
                borderColor: 'divider',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <Box>
                <Link
                  component={RouterLink}
                  to={`/change-orders/${order.id}`}
                  variant="body2"
                  fontWeight={700}
                  underline="hover"
                  color="text.primary"
                >
                  {order.number}
                </Link>
                <Typography variant="caption" color="text.secondary" component="div">
                  {formatDate(changeOrderListDate(order))}
                </Typography>
              </Box>
              <Box sx={{ justifySelf: 'start' }}>
                <ChangeOrderStatusChip status={order.status} />
              </Box>
              <Typography variant="body2" fontWeight={600}>
                {formatCurrency(order.totalAmount)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  )
}
