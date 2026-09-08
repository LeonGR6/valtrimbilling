import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  createSupervisor as createSupervisorRecord,
  deactivateSupervisor as deactivateSupervisorRecord,
  listSupervisors,
  updateSupervisor as updateSupervisorRecord,
} from '../services/supervisorsRepository.js'
import { PeopleContext } from './peopleContext.js'

function sortPeople(people) {
  return [...people].sort((left, right) => left.name.localeCompare(right.name))
}

export function PeopleProvider({ children }) {
  const { profile } = useAuth()
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canManageSupervisors = ['ADMIN', 'PROJECT_MANAGEMENT'].includes(profile?.role)

  const refreshPeople = useCallback(async () => {
    if (!profile?.id) {
      setPeople([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const records = await listSupervisors()
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

  const createSupervisor = useCallback(async (supervisor) => {
    const created = await createSupervisorRecord(supervisor)
    setPeople((current) => sortPeople([created, ...current]))
    setError(null)
    return created
  }, [])

  const updateSupervisor = useCallback(async (supervisorId, supervisor) => {
    const updated = await updateSupervisorRecord(supervisorId, supervisor)
    setPeople((current) => sortPeople(current.map((person) => (
      person.id === supervisorId ? updated : person
    ))))
    setError(null)
    return updated
  }, [])

  const deactivateSupervisor = useCallback(async (supervisorId) => {
    const updated = await deactivateSupervisorRecord(supervisorId)
    setPeople((current) => current.map((person) => (
      person.id === supervisorId ? updated : person
    )))
    setError(null)
    return updated
  }, [])

  const value = useMemo(() => ({
    people,
    loading,
    error,
    canManageSupervisors,
    refreshPeople,
    createSupervisor,
    updateSupervisor,
    deactivateSupervisor,
  }), [
    canManageSupervisors,
    createSupervisor,
    deactivateSupervisor,
    error,
    loading,
    people,
    refreshPeople,
    updateSupervisor,
  ])

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>
}
