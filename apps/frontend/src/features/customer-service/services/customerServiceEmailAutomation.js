export function emailAutomationDispatchErrors(status) {
  return (status?.dispatches ?? []).filter((entry) => entry.errorCode
    // Business outcomes belong to the per-email inbox, not connection health.
    && !(entry.kind === 'WORKER' && entry.errorCode === 'IMPORT_NEEDS_ATTENTION'))
}

export function emailAutomationMessage(status, now = Date.now()) {
  if (!status) return { severity: 'info', text: 'Checking Outlook import status…' }
  if (!status.configured) return { severity: 'info', text: 'Automatic Outlook import is not configured.' }
  if (!status.enabled) return { severity: 'info', text: 'Automatic Outlook import is paused.' }
  const lastTick = Date.parse(status.lastTickAt)
  const stale = !Number.isFinite(lastTick) || now - lastTick > 3 * 60_000
  const errors = status.errorCode || status.connectionError || status.scan?.errorCode ||
    emailAutomationDispatchErrors(status).length > 0
  if (errors || stale) return { severity: 'warning', text: 'The automatic Outlook connection could not be confirmed. Check the connection; individual email results are in the inbox.' }
  return { severity: 'success', text: 'Outlook connected. View individual email results in Outlook emails.' }
}

// Poll only small operational metadata. Full requests are fetched on a changed
// revision; never download original emails/checkpoints once per minute.
export function createCustomerServiceEmailAutomationMonitor({
  readStatus, reloadRequests, onStatus, onError,
  visible = () => true, schedule = setTimeout, cancel = clearTimeout,
}) {
  let stopped = false
  let busy = false
  let timer = null
  let revision
  let initialListLoaded = false
  const refresh = async () => {
    if (stopped || busy || !visible()) return
    if (timer !== null) cancel(timer)
    timer = null
    busy = true
    try {
      // Read before the list so a request arriving during that load is detected
      // by the next poll. Keep the previous revision if the list failed.
      const status = await readStatus()
      if (stopped) return
      onStatus(status)
      onError(null)
      if (revision !== status.requestRevision) {
        const loaded = await reloadRequests()
        if (loaded !== undefined) { revision = status.requestRevision; initialListLoaded = true }
      }
    } catch {
      if (!stopped) {
        onError('Outlook status could not be checked. Another attempt will follow.')
        if (!initialListLoaded) initialListLoaded = (await reloadRequests()) !== undefined
      }
    } finally {
      busy = false
      if (!stopped) timer = schedule(refresh, 60_000)
    }
  }
  return {
    refresh,
    stop() { stopped = true; if (timer !== null) cancel(timer) },
  }
}
