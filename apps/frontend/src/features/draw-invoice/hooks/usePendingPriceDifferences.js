import { useEffect, useState } from 'react'
import { listPendingPriceDifferences } from '../../plan-pricing/services/priceDifferencesRepository.js'
import { toPriceDifference } from '../../plan-pricing/utils/priceDifferences.js'

const NONE = []

/**
 * The price differences still pending for a Job, which a new Package can collect. Only
 * administrators and project management can read them; for anyone else, and if they cannot be
 * loaded, there are none and the Package is created as usual.
 */
export function usePendingPriceDifferences(jobId) {
  const [loaded, setLoaded] = useState({ jobId: null, rows: NONE })

  useEffect(() => {
    if (jobId == null) return undefined

    let cancelled = false
    listPendingPriceDifferences({ jobId })
      .then(({ rows }) => {
        if (!cancelled) setLoaded({ jobId, rows: rows.map(toPriceDifference) })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ jobId, rows: NONE })
      })

    return () => {
      cancelled = true
    }
  }, [jobId])

  return jobId != null && loaded.jobId === jobId ? loaded.rows : NONE
}
