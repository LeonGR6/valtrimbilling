import { useContext } from 'react'
import { CustomerServiceCalendarContext } from './customerServiceCalendarContext.js'

export function useCustomerServiceCalendar() {
  const context = useContext(CustomerServiceCalendarContext)

  if (!context) {
    throw new Error(
      'useCustomerServiceCalendar must be used inside CustomerServiceCalendarProvider.',
    )
  }

  return context
}
