// Lets screens that show document counts (the sidebar badge) know that a Job
// document was uploaded or deleted somewhere else on the page.

const JOB_DOCUMENTS_CHANGED = 'valtrim:job-documents-changed'

export function notifyJobDocumentsChanged() {
  globalThis.dispatchEvent?.(new Event(JOB_DOCUMENTS_CHANGED))
}

/** Calls `callback` after every change; returns the function that stops it. */
export function onJobDocumentsChanged(callback) {
  globalThis.addEventListener?.(JOB_DOCUMENTS_CHANGED, callback)
  return () => globalThis.removeEventListener?.(JOB_DOCUMENTS_CHANGED, callback)
}
