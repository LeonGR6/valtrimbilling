import { useMemo } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { Alert, Box, Button, Paper, Skeleton } from '@mui/material'

import {
  CatalogEmptyState,
  CatalogPageHeader,
} from '../../../components/common/CatalogPage'
import { useJobs } from '../../jobs/context/useJobs.js'
import { useChangeOrder } from '../hooks/useChangeOrderData.js'
import { toChangeOrderFormValues } from '../services/changeOrderRecord.js'
import ChangeOrderForm from './ChangeOrderForm.jsx'

const LIST = { label: 'Extra / Change Orders', to: '/change-orders' }

function PageNotice({ breadcrumbs, children }) {
  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader breadcrumbs={breadcrumbs} title="Edit Extra / Change Order" />
      <Box sx={{ p: { xs: 2.5, md: 4 } }}>{children}</Box>
    </Box>
  )
}

/**
 * The form to change a Draft or Pending Extra / Change Order. It opens once the Extra / CO and the Jobs
 * are here, because the Job tells how its Lots were chosen; it is mounted once, so what is typed is
 * never replaced by data that arrives later.
 */
export default function EditChangeOrder() {
  const { changeOrderId } = useParams()
  const { order, loading, error, reload } = useChangeOrder(changeOrderId)
  const { jobs, error: jobsError } = useJobs()

  const job = useMemo(
    () => jobs.find((item) => String(item.id) === String(order?.jobId)) ?? null,
    [jobs, order],
  )
  const jobsReady = jobs.length > 0
  const initialValues = useMemo(
    () => (order && jobsReady ? toChangeOrderFormValues(order, { job }) : null),
    [order, job, jobsReady],
  )

  const errorMessage = error || (!jobsReady && jobsError ? 'The Jobs could not be loaded.' : '')
  if (errorMessage) {
    return (
      <PageNotice breadcrumbs={[LIST, { label: 'Not available' }]}>
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={reload}>Retry</Button>}
        >
          {errorMessage}
        </Alert>
      </PageNotice>
    )
  }

  if (loading || (order && !jobsReady)) {
    return (
      <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }} aria-busy="true">
        <CatalogPageHeader breadcrumbs={[LIST, { label: 'Loading…' }]} title="Edit Extra / Change Order" />
        <Box sx={{ p: { xs: 2.5, md: 4 } }}>
          <Skeleton variant="rounded" height={200} sx={{ mb: 3 }} />
          <Skeleton variant="rounded" height={300} />
        </Box>
      </Box>
    )
  }

  if (!order) {
    return (
      <PageNotice breadcrumbs={[LIST, { label: 'Not available' }]}>
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <CatalogEmptyState
            title="This Extra / Change Order does not exist"
            description="It may have been opened from an old link."
            action={(
              <Button component={RouterLink} to="/change-orders" variant="outlined" size="small">
                Back to Extras / Change Orders
              </Button>
            )}
          />
        </Paper>
      </PageNotice>
    )
  }

  if (order.status !== 'DRAFT' && order.status !== 'PENDING') {
    return (
      <PageNotice breadcrumbs={[LIST, { label: order.number, to: `/change-orders/${order.id}` }, { label: 'Edit' }]}>
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <CatalogEmptyState
            title={`${order.number} cannot be edited`}
            description="Only a Draft or a Pending Extra / Change Order can be changed."
            action={(
              <Button component={RouterLink} to={`/change-orders/${order.id}`} variant="outlined" size="small">
                Back to {order.number}
              </Button>
            )}
          />
        </Paper>
      </PageNotice>
    )
  }

  return (
    <ChangeOrderForm
      mode="edit"
      changeOrderId={order.id}
      number={order.number}
      initialValues={initialValues}
    />
  )
}
