import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  createCompanyContact as createCompanyContactRecord,
  deactivateCompanyContact as deactivateCompanyContactRecord,
  listCompanyContacts,
  updateCompanyContact as updateCompanyContactRecord,
} from '../services/companyContactsRepository.js'
import { PeopleContext } from './peopleContext.js'

function sortPeople(people) {
  return [...people].sort((left, right) => left.name.localeCompare(right.name))
}

export function PeopleProvider({ children }) {
  const { profile } = useAuth()
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canManageContacts = ['ADMIN', 'PROJECT_MANAGEMENT'].includes(profile?.role)

  const refreshPeople = useCallback(async () => {
    if (!profile?.id) {
      setPeople([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const records = await listCompanyContacts()
      setPeople(records)
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
      setPeople([])
      setError(null)
      setLoading(false)
      return undefined
    }

    refreshPeople().catch(() => {})
    return undefined
  }, [profile?.id, refreshPeople])

  const createContact = useCallback(async (contact) => {
    const created = await createCompanyContactRecord(contact)
    setPeople((current) => sortPeople([created, ...current]))
    setError(null)
    return created
  }, [])

  const updateContact = useCallback(async (contactId, contact) => {
    const updated = await updateCompanyContactRecord(contactId, contact)
    setPeople((current) => sortPeople(current.map((person) => (
      person.id === contactId ? updated : person
    ))))
    setError(null)
    return updated
  }, [])

  const deactivateContact = useCallback(async (contactId) => {
    const updated = await deactivateCompanyContactRecord(contactId)
    setPeople((current) => current.map((person) => (
      person.id === contactId ? updated : person
    )))
    setError(null)
    return updated
  }, [])

  const value = useMemo(() => ({
    people,
    loading,
    error,
    canManageContacts,
    refreshPeople,
    createContact,
    updateContact,
    deactivateContact,
  }), [
    canManageContacts,
    createContact,
    deactivateContact,
    error,
    loading,
    people,
    refreshPeople,
    updateContact,
  ])

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>
}
