export const EMAIL_IMPORT_PAGE_SIZE = 10

// Technical import actions remain separate from request capture/review.
export function createCustomerServiceEmailImportStore(repository) {
  let snapshot = {
    count: null, countLoading: true, countError: null,
    items: [], page: 0, loading: false, error: null,
    selectedId: null, detail: null, detailLoading: false, detailError: null,
    retrying: false, retryError: null, retryResult: null,
  }
  let countVersion = 0
  let pageVersion = 0
  let detailVersion = 0
  let actionVersion = 0
  const listeners = new Set()
  const publish = (changes) => {
    snapshot = { ...snapshot, ...changes }
    listeners.forEach((listener) => listener())
  }
  const clearSelection = () => {
    detailVersion += 1
    publish({ selectedId: null, detail: null, detailLoading: false, detailError: null })
  }
  const store = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    cancelLoads() {
      countVersion += 1
      pageVersion += 1
      detailVersion += 1
      actionVersion += 1
    },
    clearSelection,
    async retryImport(receipt) {
      if (snapshot.retrying) return null
      const version = ++actionVersion
      publish({ retrying: true, retryError: null, retryResult: null })
      try {
        const result = await repository.retry(receipt)
        if (version !== actionVersion) return null
        await store.loadPage(snapshot.page)
        if (version !== actionVersion) return null
        publish({ retrying: false, retryResult: result })
        return result
      } catch (error) {
        if (version === actionVersion) {
          await store.loadPage(snapshot.page)
          if (version === actionVersion) publish({ retrying: false, retryError: error.message })
        }
        return null
      }
    },
    async loadCount() {
      const version = ++countVersion
      publish({ countLoading: true, countError: null })
      try {
        const count = await repository.count()
        if (version === countVersion) publish({ count, countLoading: false })
      } catch (error) {
        if (version === countVersion) {
          publish({ count: null, countLoading: false, countError: error.message })
        }
      }
    },
    async loadPage(page = 0) {
      if (!Number.isSafeInteger(page) || page < 0) return
      const version = ++pageVersion
      const counter = ++countVersion
      clearSelection()
      publish({ page, items: [], loading: true, error: null, countLoading: true, countError: null })
      try {
        const [count, items] = await Promise.all([
          repository.count(),
          repository.list({ limit: EMAIL_IMPORT_PAGE_SIZE, offset: page * EMAIL_IMPORT_PAGE_SIZE }),
        ])
        if (version !== pageVersion) return
        const lastPage = Math.max(0, Math.ceil(count / EMAIL_IMPORT_PAGE_SIZE) - 1)
        // Other operators/workers may have resolved the last page since opening.
        if (page > lastPage) return store.loadPage(lastPage)
        publish({ items, loading: false,
          ...(counter === countVersion ? { count, countLoading: false } : {}),
        })
      } catch (error) {
        if (version === pageVersion) {
          publish({ loading: false, error: error.message,
            ...(counter === countVersion
              ? { count: null, countLoading: false, countError: error.message } : {}),
          })
        }
      }
    },
    async selectImport(id) {
      if (!snapshot.items.some((item) => item.id === id)) return
      const version = ++detailVersion
      publish({ selectedId: id, detail: null, detailLoading: true, detailError: null })
      try {
        const detail = await repository.detail(id)
        if (version === detailVersion) publish({ detail, detailLoading: false })
      } catch (error) {
        if (version === detailVersion) publish({ detailLoading: false, detailError: error.message })
      }
    },
  }
  return store
}
