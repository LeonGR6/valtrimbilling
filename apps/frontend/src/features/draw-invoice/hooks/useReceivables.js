import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { refreshAllQuickbooksPayments } from '../services/quickbooksRepository.js'
import { listOpenReceivables } from '../services/receivablesRepository.js'

/**
 * The open invoices for the A/R screen. While a new reading loads, the last one
 * stays on screen. `refreshFromQuickbooks` asks QuickBooks for the current balances
 * first (the scheduler does the same every 30 minutes) and then reads again.
 */
export function useReceivables() {
  const { profile } = useAuth()
  const [reloads, setReloads] = useState(0)
  const [loaded, setLoaded] = useState({ key: null, records: [], error: null })
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState(null)
  const canCheckPayments = ['ADMIN', 'ACCOUNTING'].includes(profile?.role)
  const key = `${profile?.id}:${reloads}`

  useEffect(() => {
    if (!profile?.id) return undefined

    let cancelled = false
    listOpenReceivables()
      .then((records) => {
        if (!cancelled) setLoaded({ key, records, error: null })
      })
      .catch((error) => {
        if (!cancelled) setLoaded((current) => ({ key, records: current.records, error: error.message }))
      })
    return () => {
      cancelled = true
    }
  }, [key, profile?.id])

  const reload = useCallback(() => setReloads((count) => count + 1), [])

  const refreshFromQuickbooks = useCallback(async () => {
    setChecking(true)
    setCheckError(null)
    try {
      await refreshAllQuickbooksPayments()
      setReloads((count) => count + 1)
    } catch (error) {
      setCheckError(error.message || 'QuickBooks could not be checked.')
    } finally {
      setChecking(false)
    }
  }, [])

  return {
    records: loaded.records,
    loading: Boolean(profile?.id) && loaded.key !== key,
    error: loaded.error,
    reload,
    canCheckPayments,
    checking,
    checkError,
    refreshFromQuickbooks,
  }
}
