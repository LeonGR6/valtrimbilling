import { useMemo, useState } from 'react'
import { initialContacts } from '../data/builderContacts.js'
import { BuilderContactsContext } from './builderContactsContext.js'

export function BuilderContactsProvider({ children }) {
  const [contacts, setContacts] = useState(initialContacts)
  const value = useMemo(() => ({ contacts, setContacts }), [contacts])

  return (
    <BuilderContactsContext.Provider value={value}>
      {children}
    </BuilderContactsContext.Provider>
  )
}
