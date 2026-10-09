import { useEffect, useState } from 'react'
import { getQuickbooksInvoiceSync } from '../services/quickbooksRepository.js'

const TRACKED_STATUSES = ['CREATED', 'SYNC_ERROR']

/**
 * The outcome of the last QuickBooks attempt of a Package: the invoice id,
 * total and date once created, or the error after a failure. Re-read whenever
 * the Package's QuickBooks status or reference changes, e.g. after sending.
 */
export function useQuickbooksInvoiceSync(record) {
  const tracked = TRACKED_STATUSES.includes(record?.quickbooksStatus)
  const key = `${record?.id}:${record?.quickbooksStatus}:${record?.quickbooksReference ?? ''}`
  const [loaded, setLoaded] = useState({ key: null, sync: null })

  useEffect(() => {
    if (!tracked) return undefined

    let cancelled = false
    getQuickbooksInvoiceSync(record.id)
      .then((sync) => {
        if (!cancelled) setLoaded({ key, sync })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, sync: null })
      })
    return () => {
      cancelled = true
    }
  }, [key, tracked, record?.id])

  return tracked && loaded.key === key ? loaded.sync : null
}
