import { useMemo, useState } from 'react'
import { createInitialServiceCalendarEvents } from '../data/serviceCalendarEvents.js'
import { CustomerServiceCalendarContext } from './customerServiceCalendarContext.js'

export function CustomerServiceCalendarProvider({ children }) {
  const [serviceEvents, setServiceEvents] = useState(
    () => createInitialServiceCalendarEvents(),
  )

  const value = useMemo(() => ({
    serviceEvents,
    addServiceEvent(event) {
      setServiceEvents((current) => [...current, event])
    },
    updateServiceEvent(eventId, eventPatch) {
      setServiceEvents((current) => current.map((event) => (
        event.id === eventId
          ? {
              ...event,
              ...eventPatch,
              extendedProps: {
                ...event.extendedProps,
                ...eventPatch.extendedProps,
              },
            }
          : event
      )))
    },
  }), [serviceEvents])

  return (
    <CustomerServiceCalendarContext.Provider value={value}>
      {children}
    </CustomerServiceCalendarContext.Provider>
  )
}
