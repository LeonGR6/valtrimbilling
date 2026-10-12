import { useCallback, useEffect, useState } from 'react'
import { preliminaryNoticeGate } from '../utils/preliminaryNotice.js'
import { hasPreliminaryNotice } from '../services/jobDocumentsRepository.js'
import { onJobDocumentsChanged } from '../services/jobDocumentEvents.js'

/**
 * Whether creating a Package for this Job must wait for its Preliminary Notice:
 * only the first Package of a Job needs it. The answer follows uploads made
 * while the dialog is open.
 */
export function usePreliminaryNoticeGate(jobId, packages) {
  const [lookup, setLookup] = useState({ jobId: null, hasNotice: null, error: null })
  const [reloads, setReloads] = useState(0)
  const needsLookup = preliminaryNoticeGate({ jobId, packages, hasNotice: false }).required

  useEffect(() => onJobDocumentsChanged(() => setReloads((count) => count + 1)), [])

  useEffect(() => {
    if (!needsLookup) return undefined

    let cancelled = false
    hasPreliminaryNotice(jobId)
      .then((hasNotice) => {
        if (!cancelled) setLookup({ jobId: String(jobId), hasNotice, error: null })
      })
      .catch((error) => {
        if (!cancelled) setLookup({ jobId: String(jobId), hasNotice: null, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [jobId, needsLookup, reloads])

  const current = lookup.jobId === String(jobId)
  const failed = current && lookup.error != null
  const gate = preliminaryNoticeGate({
    jobId,
    packages,
    hasNotice: current ? lookup.hasNotice : null,
  })
  const recheck = useCallback(() => setReloads((count) => count + 1), [])

  // A failed lookup does not lock the dialog: the database checks it anyway.
  return {
    ...gate,
    status: failed ? 'error' : gate.status,
    blocked: failed ? false : gate.blocked,
    error: failed ? lookup.error : null,
    recheck,
  }
}
