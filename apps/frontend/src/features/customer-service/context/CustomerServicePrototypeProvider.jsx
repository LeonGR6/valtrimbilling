import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { prototypeTechnicians } from '../data/prototypeTechnicians.js'
import { customerServiceIntakeRepository } from '../services/customerServiceRequestIntake.js'
import { createCustomerServiceRequestStore } from './customerServiceRequestStore.js'
import { CustomerServicePrototypeContext } from './customerServicePrototypeContext.js'
import { requireSupabase } from '../../../services/api.js'
import { createCustomerServiceEmailAutomationMonitor } from '../services/customerServiceEmailAutomation.js'

// Requests come from Supabase. Proposal drafts and technician planning remain in memory.
export default function CustomerServicePrototypeProvider({ children }) {
  const { profile } = useAuth()
  const store = useMemo(() => createCustomerServiceRequestStore(customerServiceIntakeRepository),
    // Each signed-in actor gets a separate collection, including session PDF files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.id, profile?.role])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [proposalDrafts, setProposalDrafts] = useState({})
  const [emailAutomation, setEmailAutomation] = useState(null)
  const [emailAutomationError, setEmailAutomationError] = useState(null)
  const automationMonitor = useRef(null)
  useEffect(() => {
    if (!profile?.id || !profile.isActive || !['ADMIN', 'SCHEDULING'].includes(profile.role)) return undefined
    const monitor = createCustomerServiceEmailAutomationMonitor({
      readStatus: async () => {
        const client = await requireSupabase()
        const { data, error } = await client.rpc('read_customer_service_email_automation_status')
        if (error) throw error
        return data
      },
      reloadRequests: () => store.reloadRequests(),
      onStatus: setEmailAutomation,
      onError: setEmailAutomationError,
      visible: () => document.visibilityState !== 'hidden',
    })
    automationMonitor.current = monitor
    const refresh = () => { void monitor.refresh() }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      monitor.stop()
      if (automationMonitor.current === monitor) automationMonitor.current = null
      store.cancelLoads()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [profile?.id, profile?.role, profile?.isActive, store])
  const value = useMemo(() => ({
    ...state,
    emailAutomation, emailAutomationError,
    refreshEmailAutomation: () => automationMonitor.current?.refresh(),
    setRequests: store.setRequests,
    reloadRequests: () => store.reloadRequests(),
    createRequest: (values, submissionKey) => store.createRequest(values, submissionKey),
    recoverRequest: (receipt, values) => store.recoverRequest(receipt, values),
    completeRecovery: (importId) => store.completeRecovery(importId),
    updateRequest: (request, values) => store.updateRequest(request, values),
    markRequestReady: (request, confirmation) => store.markRequestReady(request, confirmation),
    retrySourcePdf: (id) => store.retrySourcePdf(id),
    proposalDrafts, setProposalDrafts,
    technicians: prototypeTechnicians,
  }), [state, store, proposalDrafts, emailAutomation, emailAutomationError])
  return (
    <CustomerServicePrototypeContext.Provider value={value}>
      {children}
    </CustomerServicePrototypeContext.Provider>
  )
}
