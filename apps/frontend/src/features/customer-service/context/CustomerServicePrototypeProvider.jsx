import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { customerServiceIntakeRepository } from '../services/customerServiceRequestIntake.js'
import { createCustomerServiceRequestStore } from './customerServiceRequestStore.js'
import { CustomerServicePrototypeContext } from './customerServicePrototypeContext.js'
import { requireSupabase } from '../../../services/api.js'
import { createCustomerServiceEmailAutomationMonitor } from '../services/customerServiceEmailAutomation.js'
import { listTechnicians } from '../services/techniciansRepository.js'
import {
  cancelCustomerServiceAppointment, estimateCustomerServiceNearby, estimateCustomerServiceTravel, loadCustomerServiceSchedule,
  registerCustomerServiceAppointment,
} from '../services/customerServiceAppointmentsRepository.js'
import {
  applyAppointmentsToRequests, toPlanningTechnicians, travelEstimateDetails, travelEstimatesToMinutes,
} from '../utils/appointmentRecords.js'

const emptySchedule = { roster: [], appointments: [], travelEstimates: [], travelTrafficMode: 'OFF', distanceBands: null }

// Requests, accepted appointments, travel estimates and technicians come from
// Supabase. Proposal drafts stay in memory: they are never stored.
export default function CustomerServicePrototypeProvider({ children }) {
  const { profile } = useAuth()
  const store = useMemo(() => createCustomerServiceRequestStore(customerServiceIntakeRepository),
    // Each signed-in actor gets a separate collection, including session PDF files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.id, profile?.role])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [proposalDrafts, setProposalDrafts] = useState({})
  const [schedule, setSchedule] = useState(emptySchedule)
  const [scheduleError, setScheduleError] = useState(null)
  const [emailAutomation, setEmailAutomation] = useState(null)
  const [emailAutomationError, setEmailAutomationError] = useState(null)
  const automationMonitor = useRef(null)
  const canSchedule = Boolean(profile?.id && profile.isActive && ['ADMIN', 'SCHEDULING'].includes(profile.role))

  const reloadSchedule = useCallback(async () => {
    if (!canSchedule) return
    try {
      const [roster, loaded] = await Promise.all([listTechnicians(), loadCustomerServiceSchedule()])
      setSchedule({ roster, ...loaded })
      setScheduleError(null)
    } catch (error) {
      setScheduleError(error.message)
    }
  }, [canSchedule])
  useEffect(() => {
    // Loading external data on mount; the state update happens after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadSchedule()
  }, [reloadSchedule])

  useEffect(() => {
    if (!canSchedule) return undefined
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
  }, [canSchedule, store])

  const value = useMemo(() => {
    // After a write, both the request stages and the appointments change.
    const afterScheduleChange = async (result) => {
      await Promise.all([store.reloadRequests(), reloadSchedule()])
      return result
    }
    return {
      ...state,
      requests: applyAppointmentsToRequests(state.requests, schedule.appointments, schedule.roster),
      emailAutomation, emailAutomationError,
      refreshEmailAutomation: () => automationMonitor.current?.refresh(),
      setRequests: store.setRequests,
      // Callers use the returned request list; the schedule refreshes alongside.
      reloadRequests: async () => (await Promise.all([store.reloadRequests(), reloadSchedule()]))[0],
      createRequest: (values, submissionKey) => store.createRequest(values, submissionKey),
      recoverRequest: (receipt, values) => store.recoverRequest(receipt, values),
      completeRecovery: (importId) => store.completeRecovery(importId),
      updateRequest: (request, values) => store.updateRequest(request, values),
      markRequestReady: (request, confirmation) => store.markRequestReady(request, confirmation),
      retrySourcePdf: (id) => store.retrySourcePdf(id),
      proposalDrafts, setProposalDrafts,
      technicians: toPlanningTechnicians(schedule.roster),
      storedTravelMinutes: travelEstimatesToMinutes(schedule.travelEstimates),
      storedRoutesMinutes: travelEstimatesToMinutes(schedule.travelEstimates.filter((row) => row.source === 'ROUTES_API')),
      storedTravelDetails: travelEstimateDetails(schedule.travelEstimates),
      travelTrafficMode: schedule.travelTrafficMode,
      distanceBands: schedule.distanceBands,
      estimateTravel: estimateCustomerServiceTravel,
      estimateNearby: estimateCustomerServiceNearby,
      scheduleError,
      registerAppointment: async (payload) => afterScheduleChange(await registerCustomerServiceAppointment(payload)),
      cancelAppointment: async (payload) => afterScheduleChange(await cancelCustomerServiceAppointment(payload)),
    }
  }, [state, store, proposalDrafts, emailAutomation, emailAutomationError, schedule, scheduleError, reloadSchedule])
  return (
    <CustomerServicePrototypeContext.Provider value={value}>
      {children}
    </CustomerServicePrototypeContext.Provider>
  )
}
