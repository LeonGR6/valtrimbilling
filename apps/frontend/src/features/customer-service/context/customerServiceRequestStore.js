// Async state shared by Requests, Review and Proposal Workspace. Session-only
// operations can still use setRequests until their persistence blocks land.
export function createCustomerServiceRequestStore(repository) {
  let snapshot = { requests: [], loading: true, error: null, pendingPdfIds: [] }
  let loadVersion = 0
  let mutationVersion = 0
  const pendingPdfs = new Map()
  const listeners = new Set()
  const publish = (changes) => {
    snapshot = { ...snapshot, ...changes }
    listeners.forEach((listener) => listener())
  }
  const upsert = (request) => {
    mutationVersion += 1
    publish({ requests: [request, ...snapshot.requests.filter((entry) => entry.id !== request.id)] })
  }
  const rememberPdf = (id, file) => {
    if (file) pendingPdfs.set(id, file)
    else pendingPdfs.delete(id)
    publish({ pendingPdfIds: [...pendingPdfs.keys()] })
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    cancelLoads() { loadVersion += 1 },
    setRequests(update) {
      mutationVersion += 1
      publish({ requests: typeof update === 'function' ? update(snapshot.requests) : update })
    },
    async reloadRequests() {
      const version = ++loadVersion
      const mutations = mutationVersion
      publish({ loading: true, error: null })
      try {
        const requests = await repository.list()
        if (version !== loadVersion) return
        // A load started before a create/edit must not replace newer local data.
        if (mutations !== mutationVersion) return this.reloadRequests()
        publish({ requests, error: null })
        return requests
      } catch (error) {
        if (version === loadVersion) publish({ error: error.message })
      } finally {
        if (version === loadVersion) publish({ loading: false })
      }
    },
    async createRequest(values, submissionKey) {
      try {
        const request = await repository.create(values, submissionKey)
        upsert(request)
        rememberPdf(request.id, null)
        return request
      } catch (error) {
        if (error.savedRequest) upsert(error.savedRequest)
        if (error.savedIdentity && values.sourceDocument?.sourceType === 'PDF') {
          rememberPdf(error.savedIdentity.id, values.sourceDocument.file)
        }
        throw error
      }
    },
    async updateRequest(request, values) {
      const updated = await repository.update(request, values)
      upsert(updated)
      return updated
    },
    async recoverRequest(receipt, values) {
      try {
        const request = await repository.recover(receipt, values)
        upsert(request)
        rememberPdf(request.id, null)
        return request
      } catch (error) {
        if (error.savedRequest) upsert(error.savedRequest)
        if (error.savedIdentity && values.sourceDocument?.sourceType === 'PDF') {
          rememberPdf(error.savedIdentity.id, values.sourceDocument.file)
        }
        throw error
      }
    },
    async completeRecovery(importId) {
      const request = await repository.completeRecovery(importId)
      upsert(request)
      rememberPdf(request.id, null)
      return request
    },
    async markRequestReady(request, confirmation) {
      const updated = await repository.markReady(request, confirmation)
      upsert(updated)
      return updated
    },
    async retrySourcePdf(requestId) {
      const file = pendingPdfs.get(requestId)
      if (!file) throw new Error('The original PDF is no longer available in this session.')
      const request = await repository.retryPdf(requestId, file)
      upsert(request)
      rememberPdf(requestId, null)
      return request
    },
  }
}
