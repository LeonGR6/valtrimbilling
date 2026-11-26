import { useCallback, useEffect, useMemo, useState } from 'react'
import { bestPosByLine, summarizeLinePos } from '../services/changeOrderLinePoRecord.js'
import { listLinePoMatches, poFileSignedUrl } from '../services/changeOrderPoFileRepository.js'

const NO_MATCHES = []

/**
 * The builder POs behind the lines of one Extra / CO: `{ byLine, summary, loading, error, openingId, open }`.
 * It only informs: if it cannot load, the page works without it. Read again when `version` changes (the
 * Extra / CO was saved).
 */
export function useChangeOrderLinePos(changeOrderId, lines = NO_MATCHES, version = '') {
  const [state, setState] = useState({ key: '', matches: NO_MATCHES, error: '' })
  const [openingId, setOpeningId] = useState(null)
  const key = changeOrderId ? `${changeOrderId}:${version}` : ''

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    listLinePoMatches(changeOrderId)
      .then((matches) => { if (!cancelled) setState({ key, matches, error: '' }) })
      .catch((loadError) => { if (!cancelled) setState({ key, matches: NO_MATCHES, error: loadError.message }) })
    return () => { cancelled = true }
  }, [changeOrderId, key])

  const open = useCallback(async (file) => {
    // The tab is opened before the wait, so the browser does not block it as a pop-up.
    const preview = window.open('', '_blank')
    if (preview) preview.opener = null
    setOpeningId(file.id)
    try {
      const url = await poFileSignedUrl(file)
      if (preview) preview.location.href = url
      else window.location.assign(url)
    } catch (openError) {
      preview?.close()
      setState((current) => ({ ...current, error: openError.message }))
    } finally {
      setOpeningId(null)
    }
  }, [])

  const byLine = useMemo(() => bestPosByLine(state.matches), [state.matches])
  const summary = useMemo(() => summarizeLinePos(lines, byLine), [lines, byLine])
  return { byLine, summary, loading: state.key !== key, error: state.error, openingId, open }
}
