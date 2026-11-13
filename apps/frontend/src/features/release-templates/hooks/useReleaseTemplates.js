import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  analyzeReleaseTemplate,
  confirmReleaseTemplate,
  listReleaseTemplates,
} from '../services/releaseTemplateRepository.js'

const NO_TEMPLATES = {}

/**
 * Release templates for a set of RELEASE Job document ids. The list reloads
 * whenever the ids change, which also covers a deleted document: its template
 * is deleted with it by the database.
 */
export function useReleaseTemplates(documentIds) {
  const { profile } = useAuth()
  const [loadedTemplates, setLoadedTemplates] = useState(NO_TEMPLATES)
  const [analyzingDocumentId, setAnalyzingDocumentId] = useState(null)
  const [error, setError] = useState(null)
  const userId = profile?.id ?? null
  const idsKey = documentIds.join(',')

  useEffect(() => {
    if (!userId) return undefined

    let cancelled = false
    listReleaseTemplates(idsKey ? idsKey.split(',') : [])
      .then((next) => {
        if (cancelled) return
        setLoadedTemplates(next)
        setError(null)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message)
      })
    return () => {
      cancelled = true
    }
  }, [idsKey, userId])

  const refresh = useCallback(async () => {
    const next = await listReleaseTemplates(idsKey ? idsKey.split(',') : [])
    setLoadedTemplates(next)
    setError(null)
    return next
  }, [idsKey])

  const analyze = useCallback(async (document, options) => {
    setAnalyzingDocumentId(document.id)
    try {
      const template = await analyzeReleaseTemplate(document.id, options)
      setLoadedTemplates((current) => ({ ...current, [document.id]: template }))
      return template
    } catch (analysisError) {
      // A failed run is stored as `failed`; show that state on the card.
      await refresh().catch(() => {})
      throw analysisError
    } finally {
      setAnalyzingDocumentId(null)
    }
  }, [refresh])

  const confirm = useCallback(async (input) => {
    await confirmReleaseTemplate(input)
    // Confirming can supersede another template, so reload them all.
    await refresh().catch(() => {})
  }, [refresh])

  const templatesByDocumentId = userId ? loadedTemplates : NO_TEMPLATES

  return useMemo(() => ({
    templatesByDocumentId,
    error,
    analyzingDocumentId,
    refresh,
    analyze,
    confirm,
  }), [
    analyze,
    analyzingDocumentId,
    confirm,
    error,
    refresh,
    templatesByDocumentId,
  ])
}
