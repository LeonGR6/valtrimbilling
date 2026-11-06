import { useEffect, useRef, useState } from 'react'
import {
  createQuickbooksInvoice,
  getQuickbooksInvoiceSync,
  previewQuickbooksInvoice,
} from '../services/quickbooksRepository.js'
import {
  assignedInvoiceNumber,
  quickbooksEnvironmentLabel,
  quickbooksInvoiceDate,
  quickbooksInvoiceNumberStatus,
} from '../services/quickbooksRecord.js'
import { localDateKey } from '../utils/calendarDrawSuggestions.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const NUMBER_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]{0,20}$/u
const NUMBER_DELAY_MS = 400
// A number taken meanwhile moves on to the next; this many times in a row is not a race anymore.
const MAX_NUMBER_ADVANCES = 20

/**
 * The QuickBooks invoice of a Package while it is being prepared: its date and number, the
 * preview (a dry run that sends nothing) and whether it can be created. The invoice number is
 * not typed: it is assigned (the one after the last used) and the field stays locked
 * (`numberLocked`), unless there is nothing to count from and it has to be typed. The preview
 * is read again whenever the date or the invoice number changes. The mode (Test or Production)
 * is read from the first preview and, once seen, sent back with the request: if the platform
 * was switched in between, the server sends nothing.
 *
 * `create` sends the invoice and resolves with what QuickBooks made; it rejects (and keeps the
 * message in `submitError`) when it could not. `onSettled` is called either way, because a
 * failure leaves the Package in SYNC_ERROR. With `enabled` false nothing is requested.
 */
export function useQuickbooksInvoiceDraft(record, { enabled = true, onSettled = null } = {}) {
  // The invoice is dated with the Package's cut off date, or the day it is created
  // when the Builder bills any date. The person can still change it.
  const [suggestedDate] = useState(() => quickbooksInvoiceDate(record, localDateKey(new Date())))
  const [txnDate, setTxnDate] = useState(suggestedDate.date)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  // The field is filled once the first preview tells the last number used, and stays locked. It is
  // typed only when that preview has nothing to count from.
  const [numberLocked, setNumberLocked] = useState(true)
  const typedByHand = useRef(false)
  const numberAdvances = useRef(0)
  const [settledNumber, setSettledNumber] = useState('')
  const [preview, setPreview] = useState(null)
  const [shownEnvironment, setShownEnvironment] = useState(null)
  const [lastNumber, setLastNumber] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null)

  const typed = invoiceNumber.trim()
  const validDate = DATE_PATTERN.test(txnDate)
  // The number goes to the preview once it has stopped changing and is valid.
  const numberForPreview = NUMBER_PATTERN.test(settledNumber) ? settledNumber : null
  const previewKey = `${txnDate}|${numberForPreview ?? ''}`
  // A preview belongs to the date and number it was requested for; any other is loading.
  const currentPreview = preview?.key === previewKey ? preview : null
  const loading = enabled && validDate && !result && currentPreview == null
  const previewError = currentPreview?.error ?? null
  const previewData = currentPreview?.data ?? null

  useEffect(() => {
    const timer = setTimeout(() => setSettledNumber(typed), NUMBER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [typed])

  useEffect(() => {
    if (!enabled || !validDate || result) return undefined

    let cancelled = false
    previewQuickbooksInvoice(record.id, txnDate, {
      invoiceNumber: numberForPreview,
      expectedEnvironment: shownEnvironment,
    })
      .then((data) => {
        if (cancelled) return
        setPreview({ key: previewKey, data, error: null })
        setShownEnvironment((current) => current ?? data.environment)
        setLastNumber(data.numberCheck.last)
        // The number is the one an earlier attempt kept (a retry), or the one after the last used
        // so the numbers keep their order. One typed by hand is never replaced.
        if (typedByHand.current) return
        const assigned = assignedInvoiceNumber(data.numberCheck)
        const movedOn = assigned?.number != null
          && data.numberCheck.number != null
          && assigned.number !== data.numberCheck.number
        if (movedOn) numberAdvances.current += 1
        if (assigned?.manual || numberAdvances.current > MAX_NUMBER_ADVANCES) {
          typedByHand.current = true
          setNumberLocked(false)
        } else if (assigned?.number != null) {
          setInvoiceNumber(assigned.number)
        }
      })
      .catch((error) => {
        if (!cancelled) setPreview({ key: previewKey, data: null, error })
      })
    return () => {
      cancelled = true
    }
    // The environment is read from the first preview and never re-requests one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, record.id, txnDate, validDate, result, numberForPreview, previewKey])

  const hadSyncError = record.quickbooksStatus === 'SYNC_ERROR'
  useEffect(() => {
    if (!enabled || !hadSyncError) return undefined

    let cancelled = false
    getQuickbooksInvoiceSync(record.id)
      .then((sync) => {
        if (!cancelled) setLastSync(sync)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled, hadSyncError, record.id])

  const environment = previewData?.environment ?? shownEnvironment
  const isProduction = environment === 'production'
  const numberStatus = quickbooksInvoiceNumberStatus({
    typed,
    checking: loading || settledNumber !== typed || previewData == null,
    numberCheck: previewData?.numberCheck,
  })

  const create = async () => {
    setSubmitting(true)
    setSubmitError('')
    try {
      const created = await createQuickbooksInvoice(record.id, txnDate, {
        invoiceNumber: typed,
        expectedEnvironment: environment,
      })
      setResult(created)
      return created
    } catch (error) {
      setSubmitError(error.message)
      throw error
    } finally {
      setSubmitting(false)
      // Refresh either way: a failure leaves the Package in SYNC_ERROR.
      Promise.resolve(onSettled?.()).catch(() => {})
    }
  }

  const canCreate = enabled
    && Boolean(previewData)
    && !submitting
    && !result
    && !numberStatus.blocking
    && (!isProduction || confirmed)

  return {
    txnDate,
    setTxnDate,
    suggestedDate,
    validDate,
    invoiceNumber,
    setInvoiceNumber,
    numberLocked,
    typed,
    lastNumber,
    numberStatus,
    loading,
    previewError,
    previewData,
    environment,
    environmentLabel: quickbooksEnvironmentLabel(environment),
    isProduction,
    confirmed,
    setConfirmed,
    hadSyncError,
    lastSync,
    submitting,
    submitError,
    result,
    canCreate,
    create,
  }
}
