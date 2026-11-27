import { useCallback, useEffect, useState } from 'react'
import { getQuickbooksInvoicePdf } from '../services/quickbooksRepository.js'

/**
 * The QuickBooks PDF saved for a Package (its INVOICE document), if any. It is
 * only looked up while the Package has an invoice, and again on `reload`.
 */
export function useQuickbooksInvoicePdf(record) {
  const tracked = record?.quickbooksStatus === 'CREATED'
  const [loaded, setLoaded] = useState({ key: null, pdf: null })
  const [reloads, setReloads] = useState(0)
  const key = `${record?.id}:${reloads}`

  useEffect(() => {
    if (!tracked) return undefined

    let cancelled = false
    getQuickbooksInvoicePdf(record.id)
      .then((pdf) => {
        if (!cancelled) setLoaded({ key, pdf })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, pdf: null })
      })
    return () => {
      cancelled = true
    }
  }, [key, tracked, record?.id])

  const reload = useCallback(() => setReloads((count) => count + 1), [])
  const ready = tracked && loaded.key === key

  return { pdf: ready ? loaded.pdf : null, loading: tracked && !ready, reload }
}
