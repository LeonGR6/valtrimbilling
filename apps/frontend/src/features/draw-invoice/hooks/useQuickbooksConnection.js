import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { quickbooksOAuthReturnMessage } from '../services/quickbooksRecord.js'
import {
  getQuickbooksConnection,
  startQuickbooksOAuth,
} from '../services/quickbooksRepository.js'

/** Connection status of the company-wide QuickBooks Online link, and starting OAuth. */
export function useQuickbooksConnection() {
  const { profile } = useAuth()
  const [connection, setConnection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canConnect = profile?.role === 'ADMIN'

  useEffect(() => {
    if (!profile?.id) return undefined

    let mounted = true
    getQuickbooksConnection()
      .then((next) => {
        if (!mounted) return
        setConnection(next)
        setError('')
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [profile?.id])

  // Intuit sends the browser back here with ?quickbooks=connected|error.
  useEffect(() => {
    const currentUrl = new URL(window.location.href)
    const result = currentUrl.searchParams.get('quickbooks')
    if (!result) return

    if (result === 'connected') {
      // OAuth is an external navigation result synchronized into local UI state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice('QuickBooks connected.')
    } else {
      setError(quickbooksOAuthReturnMessage(currentUrl.searchParams.get('reason')))
    }

    currentUrl.searchParams.delete('quickbooks')
    currentUrl.searchParams.delete('reason')
    window.history.replaceState({}, '', currentUrl)
  }, [])

  const connect = useCallback(async () => {
    if (!canConnect) return

    setLoading(true)
    setError('')
    try {
      window.location.assign(await startQuickbooksOAuth())
    } catch (connectError) {
      setError(connectError.message)
      setLoading(false)
    }
  }, [canConnect])

  return {
    connection,
    loading,
    error,
    notice,
    canConnect,
    connect,
    dismissError: () => setError(''),
    dismissNotice: () => setNotice(''),
  }
}
