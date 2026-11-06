import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  canManageQuickbooksCustomers,
  canSwitchQuickbooksMode,
  pickQuickbooksConnection,
  quickbooksEnvironmentLabel,
  quickbooksOAuthReturnMessage,
} from '../services/quickbooksRecord.js'
import {
  getLastQuickbooksInvoiceAt,
  getQuickbooksConnections,
  getQuickbooksSettings,
  setQuickbooksActiveEnvironment,
  startQuickbooksOAuth,
} from '../services/quickbooksRepository.js'

/**
 * The QuickBooks links of the company: Test and Production can both be connected,
 * and one of them is the mode where new invoices go. `connection` is the one of
 * the active mode; `connections` has both.
 */
export function useQuickbooksConnection() {
  const { profile } = useAuth()
  const [connections, setConnections] = useState([])
  const [settings, setSettings] = useState(null)
  const [lastInvoiceAt, setLastInvoiceAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canConnect = profile?.role === 'ADMIN'
  const canSwitch = canSwitchQuickbooksMode(profile?.role)
  const canManageCustomers = canManageQuickbooksCustomers(profile?.role)

  const activeEnvironment = settings?.activeEnvironment ?? 'sandbox'
  const connection = pickQuickbooksConnection(connections, activeEnvironment)

  // Reads both connections and the mode, and the time of the last invoice in it.
  const fetchAll = useCallback(async () => {
    const [nextConnections, nextSettings] = await Promise.all([
      getQuickbooksConnections(),
      getQuickbooksSettings(),
    ])
    // The last invoice time is a nicety: not being able to read it never hides the connection.
    const nextLastInvoiceAt = await getLastQuickbooksInvoiceAt(
      nextSettings?.activeEnvironment ?? 'sandbox',
    ).catch(() => null)
    return { nextConnections, nextSettings, nextLastInvoiceAt }
  }, [])

  const apply = useCallback(({ nextConnections, nextSettings, nextLastInvoiceAt }) => {
    setConnections(nextConnections)
    setSettings(nextSettings)
    setLastInvoiceAt(nextLastInvoiceAt)
  }, [])

  useEffect(() => {
    if (!profile?.id) return undefined

    let mounted = true
    fetchAll()
      .then((loaded) => {
        if (!mounted) return
        apply(loaded)
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
  }, [profile?.id, fetchAll, apply])

  // Intuit sends the browser back here with ?quickbooks=connected|error.
  useEffect(() => {
    const currentUrl = new URL(window.location.href)
    const result = currentUrl.searchParams.get('quickbooks')
    if (!result) return

    if (result === 'connected') {
      const label = quickbooksEnvironmentLabel(currentUrl.searchParams.get('environment'))
      // OAuth is an external navigation result synchronized into local UI state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice(label ? `QuickBooks ${label} connected.` : 'QuickBooks connected.')
    } else {
      setError(quickbooksOAuthReturnMessage(currentUrl.searchParams.get('reason')))
    }

    currentUrl.searchParams.delete('quickbooks')
    currentUrl.searchParams.delete('reason')
    currentUrl.searchParams.delete('environment')
    window.history.replaceState({}, '', currentUrl)
  }, [])

  // Connects (or reconnects) one environment through Intuit; the page is left.
  const connect = useCallback(async (environment = activeEnvironment) => {
    if (!canConnect) return

    setLoading(true)
    setError('')
    try {
      window.location.assign(await startQuickbooksOAuth(environment))
    } catch (connectError) {
      setError(connectError.message)
      setLoading(false)
    }
  }, [canConnect, activeEnvironment])

  // Chooses where new invoices go. An environment that is not connected yet is
  // connected first: there is nothing to switch to until it is.
  const switchMode = useCallback(async (environment) => {
    if (!canSwitch || environment === activeEnvironment) return

    const target = pickQuickbooksConnection(connections, environment)
    if (target?.status !== 'CONNECTED') {
      await connect(environment)
      return
    }

    setSwitching(true)
    setError('')
    try {
      await setQuickbooksActiveEnvironment(environment)
      apply(await fetchAll())
      setNotice(`New invoices now go to QuickBooks ${quickbooksEnvironmentLabel(environment)}.`)
    } catch (switchError) {
      setError(switchError.message)
    } finally {
      setSwitching(false)
    }
  }, [canSwitch, activeEnvironment, connections, connect, apply, fetchAll])

  return {
    connection,
    connections,
    activeEnvironment,
    lastInvoiceAt,
    loading,
    switching,
    error,
    notice,
    canConnect,
    canSwitch,
    canManageCustomers,
    connect: () => connect(activeEnvironment),
    connectEnvironment: connect,
    switchMode,
    dismissError: () => setError(''),
    dismissNotice: () => setNotice(''),
  }
}
