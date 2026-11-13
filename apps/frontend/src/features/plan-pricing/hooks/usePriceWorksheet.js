import { useCallback, useMemo, useState } from 'react'
import { evaluateWorksheet } from '../utils/priceWorksheet.js'

/**
 * The edit mode of the price sheet. Outside it prices are read-only; inside it
 * every price is a field and what is typed waits in `drafts` until the person
 * saves or discards it.
 */
export default function usePriceWorksheet(plans, { separateHardwarePrice = false } = {}) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState(() => new Map())

  const evaluation = useMemo(
    () => evaluateWorksheet(plans, drafts, { separateHardwarePrice }),
    [plans, drafts, separateHardwarePrice],
  )

  const setMany = useCallback((entries) => {
    setDrafts((current) => {
      const next = new Map(current)
      entries.forEach(([key, text]) => next.set(key, text))
      return next
    })
  }, [])
  const setDraft = useCallback((key, text) => setMany([[key, text]]), [setMany])
  const clearKeys = useCallback((keys) => {
    setDrafts((current) => {
      const next = new Map(current)
      keys.forEach((key) => next.delete(key))
      return next
    })
  }, [])
  const start = useCallback(() => {
    setDrafts(new Map())
    setEditing(true)
  }, [])
  const stop = useCallback(() => {
    setDrafts(new Map())
    setEditing(false)
  }, [])

  return { editing, drafts, evaluation, start, stop, setDraft, setMany, clearKeys }
}
