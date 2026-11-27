import { useCallback, useEffect, useState } from 'react'
import { listPackageSubmissions } from '../services/packageSubmissionRepository.js'

/**
 * The emails already sent for a Package, newest first. A failed lookup is just
 * "none known": the Package page works the same without it.
 */
export function usePackageSubmissions(packageId) {
  const [loaded, setLoaded] = useState({ key: null, submissions: [] })
  const [reloads, setReloads] = useState(0)
  const key = `${packageId}:${reloads}`

  useEffect(() => {
    if (packageId == null) return undefined

    let cancelled = false
    listPackageSubmissions(packageId)
      .then((submissions) => {
        if (!cancelled) setLoaded({ key, submissions })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, submissions: [] })
      })
    return () => {
      cancelled = true
    }
  }, [key, packageId])

  const reload = useCallback(() => setReloads((count) => count + 1), [])
  const ready = packageId != null && loaded.key === key

  return { submissions: ready ? loaded.submissions : [], reload }
}
