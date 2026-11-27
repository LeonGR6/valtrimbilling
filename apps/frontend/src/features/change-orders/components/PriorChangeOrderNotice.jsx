import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Link, Typography } from '@mui/material'

import { listJobPlaceLines } from '../services/changeOrderRepository.js'
import { lotsWithPriorChangeOrders, priorChangeOrdersByLot } from '../utils/priorChangeOrders.js'

const STATUS_WORDS = { DRAFT: 'Draft', PENDING: 'Pending', APPROVED: 'Approved' }

/** What an Extra / CO of a Lot says about it: "CO-0005 (Approved)", a link to the Extra / CO. */
function OrderLink({ order }) {
  return (
    <Link component={RouterLink} to={`/change-orders/${order.changeOrderId}`} underline="always">
      {order.number}
    </Link>
  )
}

/**
 * A notice for the Lots of a Sequence Sheet that already had an Extra / CO, from the time they were not in
 * the Job yet (a line without a Lot of the Extra / CO named them). It only tells: nothing else changes.
 * `lotNumbers` are the Lots being added or shown; nothing is drawn when none had one or while it loads.
 */
export default function PriorChangeOrderNotice({ jobId, lotNumbers, sx }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    let current = true
    listJobPlaceLines(jobId)
      .then((result) => { if (current) setData(result) })
      // The notice is a courtesy; a failed read says nothing rather than stopping the Sequence Sheet.
      .catch(() => { if (current) setData(null) })
    return () => { current = false }
  }, [jobId])

  const byLot = useMemo(
    () => (data ? priorChangeOrdersByLot(data.placeLines, data.changeOrders) : new Map()),
    [data],
  )
  const found = useMemo(() => lotsWithPriorChangeOrders(lotNumbers, byLot), [lotNumbers, byLot])
  if (found.length === 0) return null

  return (
    <Alert severity="info" sx={sx}>
      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
        {found.length === 1 ? 'This Lot already had an Extra / CO' : `${found.length} Lots already had an Extra / CO`}
      </Typography>
      <Typography component="ul" variant="body2" sx={{ m: 0, pl: 2.5 }}>
        {found.map((item) => (
          <li key={item.lot}>
            Lot {item.lot}:{' '}
            {item.orders.map((order, index) => (
              <span key={order.changeOrderId}>
                {index > 0 && ', '}
                <OrderLink order={order} />
                {STATUS_WORDS[order.status] ? ` (${STATUS_WORDS[order.status]})` : ''}
              </span>
            ))}
            {' '}was made for it before it was in the Job.
          </li>
        ))}
      </Typography>
    </Alert>
  )
}
