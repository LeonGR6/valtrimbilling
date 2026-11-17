// How often opening the Packages screen may ask QuickBooks how the open invoices stand.
//
// Each check reads every open invoice, and every request to the database API is logged and
// counted. The time of the last check used to live in a variable of the page, so every reload
// of the page (and every new tab) started a full check again. It is kept in the browser's
// storage instead, so a reload within the interval does not repeat it. The scheduler checks
// every 30 minutes on its own, so a Package paid in QuickBooks reaches Paid / Closed anyway.

export const PAYMENT_CHECK_INTERVAL_MS = 15 * 60 * 1000
export const PAYMENT_CHECK_STORAGE_KEY = 'valtrim.quickbooksPaymentsCheckedAt'

// Used only when the browser gives no storage (private window, blocked site data).
let lastCheckInMemory = 0

function browserStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readLastPaymentCheck(storage = browserStorage()) {
  try {
    const stored = Number(storage?.getItem(PAYMENT_CHECK_STORAGE_KEY))
    if (Number.isFinite(stored) && stored > 0) return stored
  } catch {
    // Storage unavailable: the in-memory time below is used.
  }
  return lastCheckInMemory
}

/** True when no check was made in the last PAYMENT_CHECK_INTERVAL_MS (a time in the future counts as none). */
export function paymentCheckDue(now = Date.now(), storage = browserStorage()) {
  const last = readLastPaymentCheck(storage)
  return last > now || now - last >= PAYMENT_CHECK_INTERVAL_MS
}

export function recordPaymentCheck(now = Date.now(), storage = browserStorage()) {
  lastCheckInMemory = now
  try {
    storage?.setItem(PAYMENT_CHECK_STORAGE_KEY, String(now))
  } catch {
    // Storage unavailable: the in-memory time is kept.
  }
}

/** Forgets the last check, so the next opening tries again (after a check that failed). */
export function clearPaymentCheck(storage = browserStorage()) {
  lastCheckInMemory = 0
  try {
    storage?.removeItem(PAYMENT_CHECK_STORAGE_KEY)
  } catch {
    // Nothing to forget.
  }
}
