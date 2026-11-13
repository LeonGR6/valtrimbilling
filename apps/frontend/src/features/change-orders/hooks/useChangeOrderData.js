import { useCallback, useEffect, useState } from 'react'

import {
  getChangeOrder,
  getNextChangeOrderNumber,
  listChangeOrders,
  listChangeOrderLines,
  listLotCalendarEvents,
  listBillableChangeOrders,
  listCalendarChangeOrderEvents,
  listChangeOrderEvents,
  listPackageCharges,
  listRecentChangeOrders,
} from '../services/changeOrderRepository.js'
import { listSchedulingEmails } from '../services/changeOrderEmailRepository.js'

/**
 * Reads something when the screen opens: `{ data, loading, error, reload, refresh }`. `load` must keep the
 * same identity while what it reads is the same (it is what the effect depends on).
 */
function useLoaded(load) {
  const [state, setState] = useState({ data: null, loading: true, error: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    load()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: '' })
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, loading: false, error: error.message })
      })

    return () => {
      cancelled = true
    }
  }, [load, attempt])

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }))
    setAttempt((current) => current + 1)
  }, [])

  // Reads again without going back to the loading state: what is on screen stays until the new data arrives.
  const refresh = useCallback(() => setAttempt((current) => current + 1), [])

  return { ...state, reload, refresh }
}

/** Every approved or cancelled Extra / CO, newest first, with its invoice Package. */
export function useBillableChangeOrders() {
  const { data, ...rest } = useLoaded(listBillableChangeOrders)
  return { orders: data ?? [], ...rest }
}

/** The lines of one Extra / CO, read when `changeOrderId` is given: `{ lines, loading, error }`. */
export function useChangeOrderLines(changeOrderId) {
  const load = useCallback(
    () => (changeOrderId ? listChangeOrderLines(changeOrderId) : Promise.resolve([])),
    [changeOrderId],
  )
  const { data, loading, error } = useLoaded(load)
  return { lines: data ?? [], loading, error }
}

/** Every Extra / CO, newest first. */
export function useChangeOrders() {
  const { data, ...rest } = useLoaded(listChangeOrders)
  return { orders: data ?? [], ...rest }
}

/** The newest Extras / COs. */
export function useRecentChangeOrders(limit = 3) {
  const load = useCallback(() => listRecentChangeOrders(limit), [limit])
  const { data, ...rest } = useLoaded(load)
  return { orders: data ?? [], ...rest }
}

/** The number the next Extra / CO will have; '' while it is read, when it cannot be read or when `enabled` is false. */
export function useNextChangeOrderNumber(enabled = true) {
  const load = useCallback(
    () => (enabled ? getNextChangeOrderNumber().catch(() => '') : Promise.resolve('')),
    [enabled],
  )
  const { data } = useLoaded(load)
  return data ?? ''
}

/** One Extra / CO with its lines and history; `order` is null while loading and when it is not found. */
export function useChangeOrder(changeOrderId) {
  const load = useCallback(() => getChangeOrder(changeOrderId), [changeOrderId])
  const { data, ...rest } = useLoaded(load)
  return { order: data, ...rest }
}

/**
 * The emails already sent to Scheduling about an Extra / CO, newest first: `{ emails, loading, error, refresh }`.
 * It is a convenience (the page works without it), so a failure only leaves the list empty.
 */
export function useSchedulingEmails(changeOrderId, enabled = true) {
  const load = useCallback(
    () => (enabled ? listSchedulingEmails(changeOrderId) : Promise.resolve([])),
    [changeOrderId, enabled],
  )
  const { data, ...rest } = useLoaded(load)
  return { emails: data ?? NO_EMAILS, ...rest }
}

const NO_EMAILS = []
const NO_EVENTS = []

/**
 * The Calendar events of the Lots of a Job (EXT, DM, HW), read when `jobId` is given: `{ events, loading,
 * error }`. Nothing is read without a Job. Events of another Job are never shown while the new ones load.
 */
export function useLotCalendarEvents(jobId) {
  const [state, setState] = useState({ jobId: '', events: NO_EVENTS, error: '' })
  const wanted = jobId ? String(jobId) : ''

  useEffect(() => {
    if (!wanted) return undefined
    let cancelled = false

    listLotCalendarEvents(wanted)
      .then((events) => {
        if (!cancelled) setState({ jobId: wanted, events, error: '' })
      })
      .catch((error) => {
        if (!cancelled) setState({ jobId: wanted, events: NO_EVENTS, error: error.message })
      })

    return () => {
      cancelled = true
    }
  }, [wanted])

  const ready = Boolean(wanted) && state.jobId === wanted
  return {
    events: ready ? state.events : NO_EVENTS,
    loading: Boolean(wanted) && !ready,
    error: ready ? state.error : '',
  }
}

const NO_CHARGES = []

/**
 * What a Package of the Job billing `lotIds` would charge to the "Specific Plan Types" Extras / COs:
 * `{ rows, loading, error }`. It is read again when the Lots change; what was shown stays until the new
 * answer arrives, and an answer for Lots no longer chosen is dropped.
 */
export function usePackageCharges(jobId, lotIds) {
  const key = jobId && lotIds.length > 0 ? `${jobId}:${lotIds.join(',')}` : ''
  const [state, setState] = useState({ key: '', rows: NO_CHARGES, error: '' })

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    const [job, list] = key.split(':')

    listPackageCharges(job, list.split(','))
      .then((rows) => {
        if (!cancelled) setState({ key, rows, error: '' })
      })
      .catch((error) => {
        if (!cancelled) setState({ key, rows: NO_CHARGES, error: error.message })
      })

    return () => {
      cancelled = true
    }
  }, [key])

  if (!key) return { rows: NO_CHARGES, loading: false, error: '' }
  return { rows: state.rows, loading: state.key !== key, error: state.key === key ? state.error : '' }
}

/** The events of their own of one Extra / CO: `{ events, loading, error, refresh }`. */
export function useChangeOrderEvents(changeOrderId) {
  const load = useCallback(
    () => (changeOrderId ? listChangeOrderEvents(changeOrderId) : Promise.resolve([])),
    [changeOrderId],
  )
  const { data, ...rest } = useLoaded(load)
  return { events: data ?? [], ...rest }
}

/** Every event of an approved Extra / CO, for the Production Calendar; nothing is read when `enabled` is false. */
export function useCalendarChangeOrderEvents(enabled = true) {
  const load = useCallback(
    () => (enabled ? listCalendarChangeOrderEvents() : Promise.resolve([])),
    [enabled],
  )
  const { data, ...rest } = useLoaded(load)
  return { events: data ?? [], ...rest }
}
