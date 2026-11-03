export const EMAIL_INBOX_PAGE_SIZE = 10

export function createCustomerServiceEmailInboxStore(repository) {
  let snapshot = { counts: null, filter: 'REQUIRES_ACTION', page: 0, items: [], loading: false, error: null,
    selected: null, detailLoading: false, detailError: null, busy: false, actionError: null, result: null, unconfirmedAction: null }
  let loadVersion = 0, detailVersion = 0, actionVersion = 0
  const listeners = new Set()
  const publish = (changes) => { snapshot = { ...snapshot, ...changes }; listeners.forEach((listener) => listener()) }
  const store = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    cancelLoads() { loadVersion++; detailVersion++; actionVersion++ },
    clearSelection() { if (!snapshot.busy) { detailVersion++; publish({ selected: null, detailLoading: false, detailError: null }) } },
    async loadCounts() {
      const version = ++loadVersion
      try {
        const counts = await repository.count()
        if (version === loadVersion) publish({ counts, error: null })
      } catch (error) {
        if (version === loadVersion) publish({ counts: null, error: error.message })
      }
    },
    async refresh(filter = snapshot.filter, page = snapshot.page) {
      if (!Number.isSafeInteger(page) || page < 0) return
      const version = ++loadVersion
      const selected = snapshot.selected
      const unconfirmed = snapshot.unconfirmedAction
      const tracked = unconfirmed?.item ?? selected
      const selectedVersion = detailVersion
      publish({ filter, page, loading: true, error: null })
      try {
        const [counts, items] = await Promise.all([repository.count(),
          repository.list({ state: filter, limit: EMAIL_INBOX_PAGE_SIZE, offset: page * EMAIL_INBOX_PAGE_SIZE })])
        if (version !== loadVersion) return
        const key = { REQUIRES_ACTION: 'requiresAction', PROCESSING: 'processing', REGISTERED: 'registered' }[filter] ?? 'total'
        const lastPage = Math.max(0, Math.ceil(counts[key] / EMAIL_INBOX_PAGE_SIZE) - 1)
        if (page > lastPage) return store.refresh(filter, lastPage)
        let detailChanges = {}
        if (tracked && selectedVersion === detailVersion) {
          try {
            const updated = unconfirmed ? await repository.read(tracked)
              : items.find((item) => item.id === tracked.id && item.sourceKind === tracked.sourceKind) ?? await repository.read(tracked)
            if (selectedVersion === detailVersion) {
              const sameSelection = !selected || (selected.id === updated.id && selected.sourceKind === updated.sourceKind)
              const wrongTarget = unconfirmed?.requestId != null && updated.state === 'REGISTERED' && unconfirmed.requestId !== updated.requestId
              const showResult = unconfirmed || (snapshot.result?.id === updated.id && snapshot.result.sourceKind === updated.sourceKind)
                || (selected?.state !== 'REGISTERED' && updated.state === 'REGISTERED')
              detailChanges = { ...(sameSelection ? { selected: updated, detailError: null } : {}),
                ...(showResult ? { result: wrongTarget ? null : updated } : {}),
                ...(unconfirmed ? { unconfirmedAction: null, actionError: wrongTarget
                  ? 'The email was matched to another request. Review the current result before continuing.' : null }
                  : showResult && updated.state === 'REGISTERED' ? { actionError: null } : {}) }
            }
          } catch {
            if (selectedVersion === detailVersion && !unconfirmed) detailChanges = { selected: null,
              detailError: 'The selected email changed or is no longer in the inbox. Refresh its status.' }
          }
        }
        if (version === loadVersion) publish({ counts, items, loading: false, ...detailChanges })
      } catch (error) {
        if (version === loadVersion) publish({ counts: null, loading: false, error: error.message })
      }
    },
    async select(item) {
      if (snapshot.busy) return null
      const version = ++detailVersion
      publish({ selected: null, detailLoading: true, detailError: null })
      try {
        const selected = await repository.read(item)
        if (version === detailVersion) {
          publish({ selected, detailLoading: false })
          return selected
        }
      } catch (error) {
        if (version === detailVersion) publish({ detailLoading: false, detailError: error.message })
      }
      return null
    },
    async act(kind, item, requestId) {
      if (snapshot.busy) return null
      const version = ++actionVersion
      detailVersion++
      publish({ busy: true, actionError: null, result: null, unconfirmedAction: null })
      let operationError = null
      try {
        if (kind === 'RETRY') await repository.retry(item)
        else if (kind === 'CONFIRM') await repository.confirm(item, requestId)
        else throw new Error('The selected operation is invalid.')
      } catch (error) { operationError = error }
      if (version !== actionVersion) return null
      let confirmed = null
      try {
        // A request ID in a predicted/lost worker response is not enough. Read
        // the stored inbox item, also reconciling ambiguous network responses.
        confirmed = await repository.read(item)
        if (version !== actionVersion) return null
        const wrongTarget = kind === 'CONFIRM' && confirmed.state === 'REGISTERED' && confirmed.requestId !== requestId
        publish({ selected: confirmed, detailLoading: false, detailError: null,
          actionError: wrongTarget ? 'The email was matched to another request. Review the current result before continuing.'
            : confirmed.state === 'REGISTERED' ? null : operationError?.message ?? null,
          result: wrongTarget ? null : confirmed })
      } catch {
        if (version !== actionVersion) return null
        publish({ actionError: 'The saved result could not be checked. Refresh the status before analyzing again.', result: null,
          unconfirmedAction: { item, requestId: kind === 'CONFIRM' ? requestId : null } })
      }
      if (version !== actionVersion) return null
      await store.refresh()
      if (version !== actionVersion) return null
      publish({ busy: false })
      return confirmed
    },
  }
  return store
}
