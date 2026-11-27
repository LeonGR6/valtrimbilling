import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { ADMIN_ROLES, canWork } from '../../auth/authorization/roleAccess.js'
import {
  createBuilderContact as createBuilderContactRecord,
  deactivateBuilderContact as deactivateBuilderContactRecord,
  listBuilderContactTypes,
  listBuilderContacts,
  reactivateBuilderContact as reactivateBuilderContactRecord,
  updateBuilderContact as updateBuilderContactRecord,
} from '../services/builderContactsRepository.js'
import { BuilderContactsContext } from './builderContactsContext.js'

function sortContacts(contacts) {
  return [...contacts].sort((left, right) => left.name.localeCompare(right.name))
}

function sortTypes(types) {
  return [...types].sort((left, right) => left.name.localeCompare(right.name))
}

// A contact saved with a type the team typed adds it to the saved types.
function withContactType(types, contact) {
  if (contact.type !== 'OTHER' || types.some((item) => item.id === contact.customTypeId)) {
    return types
  }
  return sortTypes([...types, { id: contact.customTypeId, name: contact.typeName }])
}

export function BuilderContactsProvider({ children }) {
  const { profile } = useAuth()
  const [contacts, setContacts] = useState([])
  const [contactTypes, setContactTypes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canManageBuilderContacts = canWork(profile?.role, ADMIN_ROLES)

  const refreshContacts = useCallback(async () => {
    if (!profile?.id) {
      setContacts([])
      setContactTypes([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const [records, types] = await Promise.all([
        listBuilderContacts(),
        listBuilderContactTypes(),
      ])
      setContacts(records)
      setContactTypes(types)
      setError(null)
      return records
    } catch (loadError) {
      setError(loadError.message)
      throw loadError
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) {
      // Authentication is the source of truth for clearing tenant data.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContacts([])
      setContactTypes([])
      setError(null)
      setLoading(false)
      return undefined
    }

    refreshContacts().catch(() => {})
    return undefined
  }, [profile?.id, refreshContacts])

  const createContact = useCallback(async (contact) => {
    const created = await createBuilderContactRecord(contact)
    setContacts((current) => sortContacts([created, ...current]))
    setContactTypes((current) => withContactType(current, created))
    setError(null)
    return created
  }, [])

  const updateContact = useCallback(async (contactId, contact) => {
    const updated = await updateBuilderContactRecord(contactId, contact)
    setContacts((current) => sortContacts(current.map((item) => (
      item.id === contactId ? updated : item
    ))))
    setContactTypes((current) => withContactType(current, updated))
    setError(null)
    return updated
  }, [])

  const replaceContact = useCallback((contactId, updated) => {
    setContacts((current) => sortContacts(current.map((item) => (
      item.id === contactId ? updated : item
    ))))
    setError(null)
    return updated
  }, [])

  const deactivateContact = useCallback(async (contactId) => {
    const updated = await deactivateBuilderContactRecord(contactId)
    return replaceContact(contactId, updated)
  }, [replaceContact])

  const reactivateContact = useCallback(async (contactId) => {
    const updated = await reactivateBuilderContactRecord(contactId)
    return replaceContact(contactId, updated)
  }, [replaceContact])

  // Keep both naming conventions while the merged screens converge on one API.
  const refreshBuilderContacts = refreshContacts
  const createBuilderContact = createContact
  const updateBuilderContact = updateContact
  const deactivateBuilderContact = deactivateContact

  const value = useMemo(() => ({
    contacts,
    contactTypes,
    loading,
    error,
    canManageBuilderContacts,
    refreshContacts,
    createContact,
    updateContact,
    deactivateContact,
    reactivateContact,
    refreshBuilderContacts,
    createBuilderContact,
    updateBuilderContact,
    deactivateBuilderContact,
  }), [
    canManageBuilderContacts,
    contacts,
    contactTypes,
    createBuilderContact,
    deactivateBuilderContact,
    error,
    loading,
    refreshBuilderContacts,
    updateBuilderContact,
    createContact,
    deactivateContact,
    reactivateContact,
    refreshContacts,
    updateContact,
  ])

  return (
    <BuilderContactsContext.Provider value={value}>
      {children}
    </BuilderContactsContext.Provider>
  )
}
