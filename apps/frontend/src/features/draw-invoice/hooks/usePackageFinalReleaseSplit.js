import { useEffect, useState } from 'react'
import { getPackageReleaseValues } from '../../release-templates/services/packageReleaseRepository.js'
import { describeSavedPackageSplit } from '../utils/finalReleaseSplit.js'

/**
 * Whether a saved Draw Package should have been divided: it finishes a Phase (or Building) of a
 * Final Release per Phase and also bills others, or finishes more than one. It reads what the
 * database says about the Package's Final Release, the same the Release screen uses, so it agrees
 * with the Release the Package gets. Returns `{ closing, others }` or null; it never fails the page.
 */
export function usePackageFinalReleaseSplit(record) {
  const applies = record?.id != null
    && (record.packageType ?? 'DRAW') === 'DRAW'
    && record.status !== 'CANCELLED'
  const key = `${record?.id}:${record?.status}`
  const [loaded, setLoaded] = useState({ key: null, split: null })

  useEffect(() => {
    if (!applies) return undefined

    let cancelled = false
    getPackageReleaseValues(record.id)
      .then((values) => {
        if (!cancelled) setLoaded({ key, split: describeSavedPackageSplit(values.finalRelease) })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, split: null })
      })
    return () => {
      cancelled = true
    }
  }, [applies, key, record?.id])

  return applies && loaded.key === key ? loaded.split : null
}
