import { useCallback, useEffect, useState } from 'react'
import {
  deletePackageRelease,
  listPackageReleases,
} from '../../release-templates/services/packageReleaseRepository.js'
import {
  deletePackagePaymentSchedule,
  listPackagePaymentSchedules,
} from '../../payment-schedules/services/packageScheduleRepository.js'

/**
 * Generated documents of one Package (its Releases and its Payment Schedule),
 * and removing them one by one. Each has a `kind`: 'release' or 'payment_schedule'.
 */
export function usePackageReleases(packageId) {
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listPackageReleases(packageId), listPackagePaymentSchedules(packageId)])
      .then(([generatedReleases, schedules]) => {
        if (cancelled) return
        setReleases([
          ...generatedReleases.map((release) => ({ ...release, kind: 'release' })),
          ...schedules,
        ])
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
    const item = releases.find(({ id }) => id === documentId)
    setRemovingId(documentId)
    setError(null)
    try {
      if (item?.kind === 'payment_schedule') await deletePackagePaymentSchedule(documentId)
      else await deletePackageRelease(documentId)
      setReleases((current) => current.filter(({ id }) => id !== documentId))
    } catch (removeError) {
      setError(removeError.message)
    } finally {
      setRemovingId(null)
    }
  }, [releases])

  return { releases, loading, removingId, error, remove }
}
