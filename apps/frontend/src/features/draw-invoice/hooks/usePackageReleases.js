import { useCallback, useEffect, useState } from 'react'
import {
  deletePackageRelease,
  listPackageReleases,
} from '../../release-templates/services/packageReleaseRepository.js'

/** Generated Releases of one Package, and removing them one by one. */
export function usePackageReleases(packageId) {
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    listPackageReleases(packageId)
      .then((next) => {
        if (!cancelled) setReleases(next)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [packageId])

  const remove = useCallback(async (documentId) => {
    setRemovingId(documentId)
    setError(null)
    try {
      await deletePackageRelease(documentId)
      setReleases((current) => current.filter(({ id }) => id !== documentId))
    } catch (removeError) {
      setError(removeError.message)
    } finally {
      setRemovingId(null)
    }
  }, [])

  return { releases, loading, removingId, error, remove }
}
