import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { loadPackagePurchaseOrders } from '../services/packagePurchaseOrders.js'

const optionsKey = (rows) => rows
  .map((row) => `${row.lotId}:${row.optionId}:${row.price}:${row.priceNotApplicable === true}`)
  .join('|')

/**
 * The Purchase Orders behind the options a Package charges, for its PDF and for warning about the
 * ones no Purchase Order backs. `status` is 'idle' (nothing to look up), 'loading', 'ready' or
 * 'error'; a failed look-up leaves the Package PDF as it was and says so.
 */
export function usePackagePurchaseOrders({ jobId, rows }) {
  const { profile } = useAuth()
  const [reloads, setReloads] = useState(0)
  const [loaded, setLoaded] = useState({ key: null, plan: null, error: null })
  const wanted = jobId == null || !profile?.id || rows.length === 0
    ? null
    : `${jobId}:${optionsKey(rows)}:${reloads}`

  useEffect(() => {
    if (wanted === null) return undefined

    let cancelled = false
    loadPackagePurchaseOrders({ jobId, rows })
      .then((plan) => {
        if (!cancelled) setLoaded({ key: wanted, plan, error: null })
      })
      .catch((error) => {
        if (!cancelled) setLoaded({ key: wanted, plan: null, error: error.message })
      })
    return () => {
      cancelled = true
    }
    // `wanted` stands for jobId and rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted])

  const reload = useCallback(() => setReloads((count) => count + 1), [])
  const current = wanted !== null && loaded.key === wanted

  return {
    status: wanted === null ? 'idle' : !current ? 'loading' : loaded.error ? 'error' : 'ready',
    plan: current ? loaded.plan : null,
    error: current ? loaded.error : null,
    reload,
  }
}
