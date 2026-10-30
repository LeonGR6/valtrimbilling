import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  addDrawPackageNote as addDrawPackageNoteRecord,
  cancelDrawInvoicePackage as cancelDrawInvoicePackageRecord,
  createDrawInvoicePackage as createDrawInvoicePackageRecord,
  createOptionsPackage as createOptionsPackageRecord,
  createPriceAdjustmentPackage as createPriceAdjustmentPackageRecord,
  createRetentionReleasePackage as createRetentionReleasePackageRecord,
  editDrawInvoicePackage as editDrawInvoicePackageRecord,
  listDrawInvoicePackages,
  transferDrawPackageCells as transferDrawPackageCellsRecord,
  updateDrawInvoicePackageStatus as updateDrawInvoicePackageStatusRecord,
} from '../services/drawInvoicePackagesRepository.js'
import { DrawInvoicePackagesContext } from './drawInvoicePackagesContext.js'

export function DrawInvoicePackagesProvider({ children }) {
  const { profile } = useAuth()
  const [drawInvoicePackages, setDrawInvoicePackages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const canManageDrawInvoicePackages = [
    'ADMIN',
    'PROJECT_MANAGEMENT',
  ].includes(profile?.role)

  const refreshDrawInvoicePackages = useCallback(async () => {
    if (!profile?.id) {
      setDrawInvoicePackages([])
      setError(null)
      return []
    }

    setLoading(true)
    try {
      const packages = await listDrawInvoicePackages()
      setDrawInvoicePackages(packages)
      setError(null)
      return packages
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
      setDrawInvoicePackages([])
      setError(null)
      setLoading(false)
      return undefined
    }

    refreshDrawInvoicePackages().catch(() => {})
    return undefined
  }, [profile?.id, refreshDrawInvoicePackages])

  const createDrawInvoicePackage = useCallback(async (input) => {
    setSaving(true)
    try {
      const { created, packages } = await createDrawInvoicePackageRecord(input)
      setDrawInvoicePackages(packages)
      setError(null)
      return created
    } catch (saveError) {
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }, [])

  const createRetentionReleasePackage = useCallback(async (input) => {
    setSaving(true)
    try {
      const { created, packages } = await createRetentionReleasePackageRecord(input)
      setDrawInvoicePackages(packages)
      setError(null)
      return created
    } catch (saveError) {
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }, [])

  const createOptionsPackage = useCallback(async (input) => {
    setSaving(true)
    try {
      const { created, packages } = await createOptionsPackageRecord(input)
      setDrawInvoicePackages(packages)
      setError(null)
      return created
    } catch (saveError) {
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }, [])

  const createPriceAdjustmentPackage = useCallback(async (input) => {
    setSaving(true)
    try {
      const { created, packages } = await createPriceAdjustmentPackageRecord(input)
      setDrawInvoicePackages(packages)
      setError(null)
      return created
    } catch (saveError) {
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }, [])

  const updateDrawInvoicePackageStatus = useCallback(async (
    packageId,
    status,
  ) => {
    setSaving(true)
    try {
      const { updated, packages } = await updateDrawInvoicePackageStatusRecord(
        packageId,
        status,
      )
      setDrawInvoicePackages(packages)
      setError(null)
      return updated
    } catch (saveError) {
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }, [])

  const runCorrection = useCallback(async (operation) => {
    setSaving(true)
    try {
      const { updated, packages } = await operation()
      setDrawInvoicePackages(packages)
      setError(null)
      return updated
    } catch (saveError) {
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }, [])

  const editDrawInvoicePackage = useCallback(
    (input) => runCorrection(() => editDrawInvoicePackageRecord(input)),
    [runCorrection],
  )
  const transferDrawPackageCells = useCallback(
    (input) => runCorrection(() => transferDrawPackageCellsRecord(input)),
    [runCorrection],
  )
  const cancelDrawInvoicePackage = useCallback(
    (packageId, reason) => runCorrection(
      () => cancelDrawInvoicePackageRecord(packageId, reason),
    ),
    [runCorrection],
  )

  // A note does not block the page: the box that wrote it shows its own progress and errors, and
  // only the notes of that Package are replaced.
  const addDrawPackageNote = useCallback(async (packageId, body) => {
    const noteEntries = await addDrawPackageNoteRecord(packageId, body)
    setDrawInvoicePackages((current) => current.map((record) => (
      String(record.id) === String(packageId) ? { ...record, noteEntries } : record
    )))
  }, [])

  const value = useMemo(
    () => ({
      drawInvoicePackages,
      loading,
      error,
      saving,
      canManageDrawInvoicePackages,
      refreshDrawInvoicePackages,
      createDrawInvoicePackage,
      createRetentionReleasePackage,
      createOptionsPackage,
      createPriceAdjustmentPackage,
      updateDrawInvoicePackageStatus,
      editDrawInvoicePackage,
      transferDrawPackageCells,
      cancelDrawInvoicePackage,
      addDrawPackageNote,
    }),
    [
      addDrawPackageNote,
      canManageDrawInvoicePackages,
      createDrawInvoicePackage,
      createRetentionReleasePackage,
      createOptionsPackage,
      createPriceAdjustmentPackage,
      editDrawInvoicePackage,
      drawInvoicePackages,
      error,
      loading,
      refreshDrawInvoicePackages,
      saving,
      updateDrawInvoicePackageStatus,
      transferDrawPackageCells,
      cancelDrawInvoicePackage,
    ],
  )

  return (
    <DrawInvoicePackagesContext.Provider value={value}>
      {children}
    </DrawInvoicePackagesContext.Provider>
  )
}
