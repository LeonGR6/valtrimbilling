import { useCallback, useEffect, useState } from 'react'

import {
  getChangeOrder,
  getNextChangeOrderNumber,
  listChangeOrders,
  listLotCalendarEvents,
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
