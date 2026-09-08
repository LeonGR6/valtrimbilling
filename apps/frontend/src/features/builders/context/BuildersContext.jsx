import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  createBuilder as createBuilderRecord,
  deactivateBuilder as deactivateBuilderRecord,
  listBuilders,
  updateBuilder as updateBuilderRecord,
  updateBuilderDateConfiguration as updateBuilderDateConfigurationRecord,
} from '../services/buildersRepository.js'
import { BuildersContext } from './buildersContext.js'

function sortBuilders(builders) {
  return [...builders].sort((left, right) => left.name.localeCompare(right.name))
}

export function BuildersProvider({ children }) {
  const { profile } = useAuth()
  const [builders, setBuilders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canManageBuilders = ['ADMIN', 'PROJECT_MANAGEMENT'].includes(profile?.role)

  const refreshBuilders = useCallback(async () => {
    if (!profile?.id) {
      setBuilders([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const records = await listBuilders()
      setBuilders(records)
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
      setBuilders([])
      setError(null)
      setLoading(false)
      return undefined
    }

    refreshBuilders().catch(() => {})
    return undefined
  }, [profile?.id, refreshBuilders])

  const createBuilder = useCallback(async (builder) => {
    const created = await createBuilderRecord(builder)
    setBuilders((current) => sortBuilders([created, ...current]))
    setError(null)
    return created
  }, [])

  const updateBuilder = useCallback(async (builderId, builder) => {
    const updated = await updateBuilderRecord(builderId, builder)
    setBuilders((current) => sortBuilders(current.map((item) => (
      item.id === builderId ? updated : item
    ))))
    setError(null)
    return updated
  }, [])

  const deactivateBuilder = useCallback(async (builderId) => {
    const updated = await deactivateBuilderRecord(builderId)
    setBuilders((current) => current.map((item) => (
      item.id === builderId ? updated : item
    )))
    setError(null)
    return updated
  }, [])

  const updateBuilderDateConfiguration = useCallback(async (builderId, configuration) => {
    const updated = await updateBuilderDateConfigurationRecord(builderId, configuration)
    setBuilders((current) => current.map((item) => (
      item.id === builderId ? updated : item
    )))
    setError(null)
    return updated
  }, [])

  const value = useMemo(() => ({
    builders,
    loading,
    error,
    canManageBuilders,
    refreshBuilders,
    createBuilder,
    updateBuilder,
    deactivateBuilder,
    updateBuilderDateConfiguration,
  }), [
    builders,
    canManageBuilders,
    createBuilder,
    deactivateBuilder,
    error,
    loading,
    refreshBuilders,
    updateBuilder,
    updateBuilderDateConfiguration,
  ])

  return <BuildersContext.Provider value={value}>{children}</BuildersContext.Provider>
}
