import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/context/useAuth.js'
import { groupPoFilesByJob, groupPoOrdersByFile } from '../services/changeOrderPoFileRecord.js'
import { changeOrdersByPo } from '../services/changeOrderLinePoRecord.js'
import {
  deletePoFile,
  listLinePoMatches,
  listPoFiles,
  listPoOrders,
  poFileSignedUrl,
  readPoFile,
  uploadPoFile,
} from '../services/changeOrderPoFileRepository.js'
import { canEditChangeOrders } from '../services/changeOrderRecord.js'

/**
 * The Purchase Order PDFs of every Job and the orders read from them; uploading, reading, opening and
 * deleting them.
 */
export function useChangeOrderPoFiles() {
  const { profile } = useAuth()
  const [files, setFiles] = useState([])
  const [orders, setOrders] = useState([])
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openingId, setOpeningId] = useState(null)
  // The PDFs being read from this screen, and why the last reading of each failed.
  const [readingIds, setReadingIds] = useState(() => new Set())
  const [readErrors, setReadErrors] = useState({})
  const canManage = canEditChangeOrders(profile?.role)

  const reload = useCallback(async () => {
    try {
      // Which Extras / COs each order backs is a convenience: without it the orders still show.
      const [nextFiles, nextOrders, nextMatches] = await Promise.all([
        listPoFiles(),
        listPoOrders(),
        listLinePoMatches().catch(() => []),
      ])
      setFiles(nextFiles)
      setOrders(nextOrders)
      setMatches(nextMatches)
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!profile?.id) return
    // Loading the list is what this effect is for.
    reload()
  }, [profile?.id, reload])

  /** Reads the PDFs one after the other (each one can take a minute), then shows what was found. */
  const read = useCallback(async (fileIds) => {
    const ids = [...new Set(fileIds)]
    if (ids.length === 0) return { read: 0, failed: 0 }
    setReadingIds((current) => new Set([...current, ...ids]))
    setReadErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id))))
    let done = 0
    let failed = 0
    for (const id of ids) {
      try {
        await readPoFile(id)
        done += 1
      } catch (readError) {
        failed += 1
        setReadErrors((current) => ({ ...current, [id]: readError.message }))
      } finally {
        setReadingIds((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
        await reload()
      }
    }
    return { read: done, failed }
  }, [reload])

  /**
   * Uploads the PDFs one after the other. One that fails (a copy already there, not a PDF) does not
   * stop the others: the result says which went in (with their ids) and why each other did not.
   */
  const upload = useCallback(async (jobId, list) => {
    const uploaded = []
    const uploadedIds = []
    const failed = []
    for (const file of list) {
      try {
        uploadedIds.push(await uploadPoFile(jobId, file))
        uploaded.push(file.name)
      } catch (uploadError) {
        failed.push({ name: file.name, message: uploadError.message })
      }
    }
    if (uploaded.length > 0) await reload()
    return { uploaded, uploadedIds, failed }
  }, [reload])

  const open = useCallback(async (poFile) => {
    // The tab is opened before the wait, so the browser does not block it as a pop-up.
    const preview = window.open('', '_blank')
    if (preview) preview.opener = null
    setOpeningId(poFile.id)
    try {
      const url = await poFileSignedUrl(poFile)
      if (preview) preview.location.href = url
      else window.location.assign(url)
      setError('')
    } catch (openError) {
      preview?.close()
      setError(openError.message)
    } finally {
      setOpeningId(null)
    }
  }, [])

  const remove = useCallback(async (poFile) => {
    try {
      await deletePoFile(poFile)
    } finally {
      await reload()
    }
  }, [reload])

  const filesByJob = useMemo(() => groupPoFilesByJob(files), [files])
  const ordersByFile = useMemo(() => groupPoOrdersByFile(orders), [orders])
  const changeOrdersByOrder = useMemo(() => changeOrdersByPo(matches), [matches])

  return {
    files,
    filesByJob,
    ordersByFile,
    changeOrdersByOrder,
    loading,
    error,
    openingId,
    readingIds,
    readErrors,
    canManage,
    reload,
    upload,
    read,
    open,
    remove,
  }
}
