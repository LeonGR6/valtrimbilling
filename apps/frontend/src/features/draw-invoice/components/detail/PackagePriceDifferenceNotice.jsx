import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Button } from '@mui/material'
import { listPendingPriceDifferences } from '../../../plan-pricing/services/priceDifferencesRepository.js'
import {
  formatSignedMoney,
  groupPriceDifferences,
} from '../../../plan-pricing/utils/priceDifferences.js'
import { jobPlanPricingPath } from '../../../jobs/utils/jobRoutes.js'

/**
 * Tells that this Package keeps the amount it billed but its Phases moved to a new
 * price, and how much is pending to collect. Only administrators and project
 * management can read the differences; for anyone else nothing is shown.
 */
export default function PackagePriceDifferenceNotice({ packageId, builderId, jobId, refreshKey }) {
  const [totals, setTotals] = useState(null)

  useEffect(() => {
    let cancelled = false

    listPendingPriceDifferences({ packageId })
      .then(({ rows, statuses }) => {
        if (cancelled) return
        const { totals: loaded } = groupPriceDifferences(rows, statuses)
        setTotals(loaded.lineCount > 0 ? loaded : null)
      })
      .catch(() => {
        if (!cancelled) setTotals(null)
      })

    return () => { cancelled = true }
  }, [packageId, refreshKey])

  if (!totals) return null

  return (
    <Alert
      severity="warning"
      action={builderId != null && jobId != null ? (
        <Button
          component={RouterLink}
          to={`${jobPlanPricingPath(builderId, jobId)}?differences=1`}
          color="inherit"
          size="small"
        >
          Review
        </Button>
      ) : undefined}
    >
      This Package keeps the amount it billed, but its Phases moved to a new price. Pending to collect:{' '}
      <strong>{formatSignedMoney(totals.net)}</strong> net ({formatSignedMoney(totals.gross)} gross,
      retention {formatSignedMoney(totals.retention)}, WRAP {formatSignedMoney(totals.wrap)}).
    </Alert>
  )
}
