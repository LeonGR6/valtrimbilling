import { useContext } from 'react'
import { PeopleContext } from './peopleContext.js'

export function usePeople() {
  const context = useContext(PeopleContext)

  if (!context) {
    throw new Error('usePeople must be used inside PeopleProvider.')
  }

  return context
}
