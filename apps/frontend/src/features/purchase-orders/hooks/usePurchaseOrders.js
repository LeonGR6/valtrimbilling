import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import {
  adoptPurchaseOrderPrice,
  analyzePurchaseOrder,
  comparePurchaseOrders,
  confirmPurchaseOrderHeader,
  importPurchaseOrderOptions,
  listPurchaseOrderAnalyses,
  listPurchaseOrderFiles,
  listPurchaseOrderLineLots,
  listUncoveredOptions,
  rematchPurchaseOrders,
} from '../services/purchaseOrderRepository.js'
import { createJobDocumentSignedUrl } from '../../draw-invoice/services/jobDocumentsRepository.js'
import { buildOptionOrderIndex, buildPurchaseOrderBacking } from '../services/purchaseOrderRecord.js'

const NO_ANALYSES = {}

/**
 * Purchase Order analyses for a set of Job document ids. The list reloads whenever
 * the ids change, which also covers a deleted document: its analysis is deleted
 * with it by the database. `revision` grows whenever the stored lines change, so
 * a comparison on screen knows to load again.
 */
export function usePurchaseOrders(documentIds) {
  const { profile } = useAuth()
  const [loaded, setLoaded] = useState(NO_ANALYSES)
  const [analyzingDocumentId, setAnalyzingDocumentId] = useState(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState(null)
  const userId = profile?.id ?? null
  const idsKey = documentIds.join(',')

  useEffect(() => {
    if (!userId) return undefined

    let cancelled = false
    listPurchaseOrderAnalyses(idsKey ? idsKey.split(',') : [])
      .then((next) => {
        if (cancelled) return
        setLoaded(next)
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
    const next = await listPurchaseOrderAnalyses(idsKey ? idsKey.split(',') : [])
    setLoaded(next)
    setError(null)
    return next
  }, [idsKey])

  const analyze = useCallback(async (document, options) => {
    setAnalyzingDocumentId(document.id)
    try {
      const analysis = await analyzePurchaseOrder(document.id, options)
      setLoaded((current) => ({ ...current, [document.id]: analysis }))
      setRevision((current) => current + 1)
      return analysis
    } catch (analysisError) {
      // A failed run is stored as `failed`; show that state on the card.
      await refresh().catch(() => {})
      throw analysisError
    } finally {
      setAnalyzingDocumentId(null)
    }
  }, [refresh])

  const rematch = useCallback(async (document) => {
    await rematchPurchaseOrders(document.id)
    setRevision((current) => current + 1)
  }, [])

  const confirmHeader = useCallback(async ({ document, workOrderNo }) => {
    await confirmPurchaseOrderHeader({ documentId: document.id, workOrderNo })
    setRevision((current) => current + 1)
  }, [])

  const importOptions = useCallback(async (lineIds) => {
    try {
      return await importPurchaseOrderOptions(lineIds)
    } finally {
      // Whatever happened, what the comparison shows may have changed.
      setRevision((current) => current + 1)
    }
  }, [])

  const adoptPrice = useCallback(async (input) => {
    try {
      return await adoptPurchaseOrderPrice(input)
    } finally {
      setRevision((current) => current + 1)
    }
  }, [])

  const analysesByDocumentId = userId ? loaded : NO_ANALYSES

  return useMemo(() => ({
    analysesByDocumentId,
    error,
    analyzingDocumentId,
    revision,
    refresh,
    analyze,
    rematch,
    confirmHeader,
    importOptions,
    adoptPrice,
  }), [
    adoptPrice,
    analyze,
    analysesByDocumentId,
    analyzingDocumentId,
    confirmHeader,
    error,
    importOptions,
    refresh,
    rematch,
    revision,
  ])
}

const NOTHING_COMPARED = { lines: [], uncovered: [] }

/**
 * Every current Purchase Order line of a Job against the system, loaded again
 * whenever `revision` changes. Pass a null `jobId` to load nothing.
 */
export function usePurchaseOrderComparison(jobId, revision) {
  const { profile } = useAuth()
  const userId = profile?.id ?? null
  const [state, setState] = useState({ key: null, ...NOTHING_COMPARED, error: null })
  const key = jobId == null || !userId ? null : `${jobId}:${revision}`

  useEffect(() => {
    if (key === null) return undefined

    let cancelled = false
    Promise.all([comparePurchaseOrders(jobId), listUncoveredOptions(jobId)])
      .then(([lines, uncovered]) => {
        if (!cancelled) setState({ key, lines, uncovered, error: null })
      })
      .catch((loadError) => {
        if (!cancelled) setState({ key, ...NOTHING_COMPARED, error: loadError.message })
      })
    return () => {
      cancelled = true
    }
  }, [jobId, key])

  return useMemo(() => ({
    lines: key !== null && state.key === key ? state.lines : NOTHING_COMPARED.lines,
    uncovered: key !== null && state.key === key ? state.uncovered : NOTHING_COMPARED.uncovered,
    error: key !== null && state.key === key ? state.error : null,
    loading: key !== null && state.key !== key,
  }), [key, state])
}

const NO_BACKING = { jobId: null, backing: null }

/**
 * Whether the Purchase Orders of a Job back the options a Package bills. It is only
 * information, so a failed load simply shows nothing. Pass a null `jobId` to load
 * nothing.
 */
export function usePurchaseOrderBacking(jobId) {
  const { profile } = useAuth()
  const userId = profile?.id ?? null
  const [loaded, setLoaded] = useState(NO_BACKING)
  const wanted = jobId == null || !userId ? null : String(jobId)

  useEffect(() => {
    if (wanted === null) return undefined

    let cancelled = false
    comparePurchaseOrders(wanted)
      .then((lines) => {
        if (!cancelled) setLoaded({ jobId: wanted, backing: buildPurchaseOrderBacking(lines) })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ jobId: wanted, backing: null })
      })
    return () => {
      cancelled = true
    }
  }, [wanted])

  return wanted !== null && loaded.jobId === wanted ? loaded.backing : null
}

const NO_LOTS = { jobId: null, lotsByAnalysis: new Map() }

/**
 * The Lot and Phase of every stored line of a Job's Purchase Orders, by analysis, to
 * place each PDF in its Phase. Information only: a failed load shows nothing. Pass a null
 * `jobId` to load nothing; it loads again whenever `revision` changes.
 */
export function usePurchaseOrderLineLots(jobId, revision) {
  const { profile } = useAuth()
  const userId = profile?.id ?? null
  const [loaded, setLoaded] = useState(NO_LOTS)
  const wanted = jobId == null || !userId ? null : `${jobId}:${revision}`

  useEffect(() => {
    if (wanted === null) return undefined

    let cancelled = false
    listPurchaseOrderLineLots(jobId)
      .then((lotsByAnalysis) => {
        if (!cancelled) setLoaded({ key: wanted, lotsByAnalysis })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: wanted, lotsByAnalysis: NO_LOTS.lotsByAnalysis })
      })
    return () => {
      cancelled = true
    }
  }, [jobId, wanted])

  return wanted !== null && loaded.key === wanted ? loaded.lotsByAnalysis : NO_LOTS.lotsByAnalysis
}

const NO_LINKS = { jobId: null, index: null, files: {} }

/**
 * The Purchase Orders behind the options of a Job, to show beside each option of the
 * Sequence Sheet: `index.linesFor(...)` for the lines of an option, `files` for the PDF of
 * each, and `openFile` to open one in a new tab. Information only: a failed load shows
 * nothing. Pass a null `jobId` to load nothing.
 */
export function usePurchaseOrderOptionLinks(jobId) {
  const { profile } = useAuth()
  const userId = profile?.id ?? null
  const wanted = jobId == null || !userId ? null : String(jobId)
  const [loaded, setLoaded] = useState(NO_LINKS)
  const [openingId, setOpeningId] = useState(null)
  const [openError, setOpenError] = useState(null)

  useEffect(() => {
    if (wanted === null) return undefined

    let cancelled = false
    comparePurchaseOrders(wanted)
      .then(async (lines) => {
        const ids = [...new Set(lines.filter((line) => line.lotId !== null).map((line) => line.documentId))]
        const files = await listPurchaseOrderFiles(ids).catch(() => ({}))
        if (!cancelled) setLoaded({ jobId: wanted, index: buildOptionOrderIndex(lines), files })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ jobId: wanted, index: null, files: {} })
      })
    return () => {
      cancelled = true
    }
  }, [wanted])

  const openFile = useCallback(async (file) => {
    // The tab opens first, while the click still counts, and gets its address after.
    const previewWindow = window.open('', '_blank')
    if (previewWindow) previewWindow.opener = null
    setOpeningId(file.id)
    setOpenError(null)
    try {
      const signedUrl = await createJobDocumentSignedUrl(file)
      if (previewWindow) previewWindow.location.href = signedUrl
      else window.location.assign(signedUrl)
    } catch (error) {
      previewWindow?.close()
      setOpenError(error.message)
    } finally {
      setOpeningId(null)
    }
  }, [])

  const ready = wanted !== null && loaded.jobId === wanted
  return useMemo(() => ({
    index: ready ? loaded.index : null,
    files: ready ? loaded.files : NO_LINKS.files,
    openFile,
    openingId,
    openError,
  }), [loaded, openError, openFile, openingId, ready])
}
