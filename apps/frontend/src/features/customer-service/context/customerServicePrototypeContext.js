import { createContext, useContext } from 'react'

export const CustomerServicePrototypeContext = createContext(null)

export function useCustomerServicePrototype() {
  const context = useContext(CustomerServicePrototypeContext)
  if (!context) throw new Error('Customer Service requires its prototype provider.')
  return context
}
