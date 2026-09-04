import { useContext } from 'react'
import { BuilderContactsContext } from './builderContactsContext.js'

export function useBuilderContacts() {
  const context = useContext(BuilderContactsContext)

  if (!context) {
    throw new Error('useBuilderContacts must be used inside BuilderContactsProvider.')
  }

  return context
}
