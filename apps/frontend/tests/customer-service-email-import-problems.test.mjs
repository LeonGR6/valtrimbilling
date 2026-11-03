import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createCustomerServiceEmailImportRepository, safeEmailWebLink, toEmailImportDetail, toEmailImportSummary,
} from '../src/features/customer-service/services/customerServiceEmailImportRepository.js'
import { createCustomerServiceEmailImportStore } from '../src/features/customer-service/context/customerServiceEmailImportStore.js'
import { emailImportProblemTitle, formatEmailImportDate } from '../src/features/customer-service/utils/emailImportProblems.js'

const id = 'ea7461c0-0b79-4bc9-85bf-fa6910fd7d5b'
function receipt(overrides = {}) {
  return {
    id, subject: 'Solicitud de prueba', from: 'builder@example.com', status: 'NEEDS_ATTENTION',
    created_at: '2026-10-23T18:00:00Z', updated_at: '2026-10-23T18:05:00Z',
    attempt_count: 3, last_attempt_at: '2026-10-23T18:04:00Z',
    error_code: 'ANALYSIS_FAILED', error_message: 'No se pudo leer el PDF.',
    request_id: null, request_folio: null,
    ...overrides,
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function repositoryFor(rpc) {
  return createCustomerServiceEmailImportRepository({ getClient: async () => ({ rpc }) })
}
const item = (rowId = id) => toEmailImportSummary(receipt({ id: rowId }))
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('counter reads needsAttention, never treats pending/processed or requests awaiting review as problems', async () => {
  const calls = []
  const repository = repositoryFor(async (name, params) => {
    calls.push({ name, params })
    return { data: { total: 20, pending: 8, processing: 4, needsAttention: 3, processed: 5 } }
  })
  assert.equal(await repository.count(), 3)
  assert.deepEqual(calls, [{ name: 'count_customer_service_email_imports', params: {} }])
})

test('only NEEDS_ATTENTION summaries are loaded in bounded pages, without fetching detail or mutating', async () => {
  const calls = []
  const repository = repositoryFor(async (name, params) => {
    calls.push({ name, params })
    return { data: [receipt({ request_id: 596, request_folio: 'CS-1596' })] }
  })
  const [summary] = await repository.list({ limit: 10, offset: 20 })
  assert.deepEqual(calls, [{ name: 'list_customer_service_email_imports', params: {
    p_status: 'NEEDS_ATTENTION', p_limit: 10, p_offset: 20,
  } }])
  assert.equal(summary.requestId, 596)
  assert.equal(summary.requestFolio, 'CS-1596')
})

test('invalid paging arguments make no network request', async () => {
  const repository = repositoryFor(() => assert.fail('RPC must not run'))
  for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: NaN }]) {
    await assert.rejects(repository.list(args), /page/)
  }
})

test('a genuine empty list/count is distinct from absent or malformed server results', async () => {
  assert.equal(await repositoryFor(async () => ({ data: { needsAttention: 0 } })).count(), 0)
  assert.deepEqual(await repositoryFor(async () => ({ data: [] })).list(), [])
  for (const data of [null, {}, { needsAttention: -1 }, { needsAttention: '3' }]) {
    await assert.rejects(repositoryFor(async () => ({ data })).count(), /valid count/)
  }
  for (const data of [null, {}, [null], [receipt({ status: 'PENDING' })]]) {
    await assert.rejects(repositoryFor(async () => ({ data })).list(), /valid import list/)
  }
})

test('permission and transport failures do not become an empty inbox or expose raw infrastructure errors', async () => {
  for (const method of ['count', 'list', 'detail']) {
    const cause = { code: '42501', message: 'raw database internals' }
    await assert.rejects(repositoryFor(async () => ({ error: cause }))[method](id), (error) => {
      assert.match(error.message, /permission/)
      assert.equal(error.cause, cause)
      assert.doesNotMatch(error.message, /internals/)
      return true
    })
    await assert.rejects(repositoryFor(async () => ({ error: { message: 'raw provider secret' } }))[method](id),
      (error) => !error.message.includes('secret'))
  }
})

test('sender formats support strings, normalized objects and Microsoft emailAddress envelopes', () => {
  assert.equal(toEmailImportSummary(receipt()).sender, 'builder@example.com')
  for (const from of [{ name: 'Builder', address: 'builder@example.com' },
    { emailAddress: { name: 'Builder', address: 'builder@example.com' } }]) {
    assert.equal(toEmailImportSummary(receipt({ from })).sender, 'Builder · builder@example.com')
  }
  const summary = toEmailImportSummary(receipt({ subject: null, from: null }))
  assert.equal(summary.subject, 'No subject')
  assert.equal(summary.sender, 'Sender not available')
})

test('summaries and detail retain only display metadata and never worker tokens, bodies, extraction or binary refs', async () => {
  const row = receipt({ worker_token: 'do-not-retain', worker_checkpoint: { sources: ['private'] },
    extraction_payload: { intake: 'private' }, analysis_payload: { sources: ['private'] },
    attachment_refs: [{ objectPath: 'private-object' }],
    source_payload: { subject: 'Original', from: 'original@example.com', bodyText: 'Private body',
      webLink: 'https://outlook.office.com/mail/test' },
  })
  const calls = []
  const detail = await repositoryFor(async (name, params) => {
    calls.push({ name, params })
    return { data: row }
  }).detail(id)
  assert.deepEqual(calls, [{ name: 'read_customer_service_email_import', params: { p_import_id: id } }])
  assert.equal(detail.subject, 'Original')
  assert.equal(detail.webLink, row.source_payload.webLink)
  for (const record of [toEmailImportSummary(row), detail]) {
    for (const field of ['worker_token', 'worker_checkpoint', 'extraction_payload', 'analysis_payload', 'attachment_refs', 'source_payload']) {
      assert.equal(field in record, false)
    }
    assert.doesNotMatch(JSON.stringify(record), /Private body|do-not-retain|private-object/)
  }
})

test('a missing or mismatched detail is an error, and absent source metadata remains absent', async () => {
  for (const data of [null, receipt({ id: 'another-id' })]) {
    await assert.rejects(repositoryFor(async () => ({ data })).detail(id), /not available/)
  }
  assert.equal(toEmailImportDetail(receipt()).webLink, null)
})

test('original email links allow HTTPS only, without credentials; markup is not interpreted as a URL', () => {
  assert.equal(safeEmailWebLink('https://outlook.office.com/mail/id/abc?x=1'), 'https://outlook.office.com/mail/id/abc?x=1')
  for (const value of ['', null, {}, 'javascript:alert(1)', 'data:text/html,test', 'file:///secret',
    'http://outlook.office.com/mail', '//outlook.office.com/mail', 'https://user:pass@outlook.office.com', '<a href="x">email</a>']) {
    assert.equal(safeEmailWebLink(value), null)
  }
})

test('dates use the California operating timezone and unknown error codes have a safe fallback', () => {
  assert.equal(formatEmailImportDate(null), 'Not available')
  assert.equal(formatEmailImportDate('invalid'), 'Not available')
  assert.match(formatEmailImportDate('2026-10-23T01:00:00Z'), /10\/22\/26/)
  assert.match(emailImportProblemTitle('ATTACHMENT_SIZE'), /file size/)
  assert.match(emailImportProblemTitle('ANALYSIS_INCOMPLETE'), /Required details/)
  assert.equal(emailImportProblemTitle('toString'), 'The import needs attention')
  assert.equal(emailImportProblemTitle('FUTURE_CODE'), 'The import needs attention')
})

test('initial store loads only the counter; list/detail are lazy', async () => {
  const store = createCustomerServiceEmailImportStore({ count: async () => 4,
    list: () => assert.fail('List is lazy'), detail: () => assert.fail('Detail is lazy') })
  assert.equal(store.getSnapshot().count, null)
  await store.loadCount()
  assert.equal(store.getSnapshot().count, 4)
  assert.equal(store.getSnapshot().countLoading, false)
  assert.deepEqual(store.getSnapshot().items, [])
})

test('opening and paging load bounded summaries and refresh the counter without invoking the worker', async () => {
  const calls = []
  const store = createCustomerServiceEmailImportStore({ count: async () => 21,
    list: async (args) => { calls.push(args); return [item()] } })
  await store.loadPage(0)
  await store.loadPage(1)
  assert.deepEqual(calls, [{ limit: 10, offset: 0 }, { limit: 10, offset: 10 }])
  assert.equal(store.getSnapshot().count, 21)
  assert.equal(store.getSnapshot().page, 1)
  assert.equal(store.getSnapshot().loading, false)
})

test('counter errors are unknown, never a misleading zero, and can be recovered', async () => {
  let fail = true
  const store = createCustomerServiceEmailImportStore({ count: async () => {
    if (fail) throw new Error('Permission denied')
    return 0
  } })
  await store.loadCount()
  assert.equal(store.getSnapshot().count, null)
  assert.equal(store.getSnapshot().countError, 'Permission denied')
  fail = false
  await store.loadCount()
  assert.equal(store.getSnapshot().count, 0)
  assert.equal(store.getSnapshot().countError, null)
})

test('page failures do not masquerade as a valid empty result; refreshing can recover', async () => {
  let fail = true
  const store = createCustomerServiceEmailImportStore({ count: async () => 1, list: async () => {
    if (fail) throw new Error('Offline')
    return [item()]
  } })
  await store.loadPage()
  assert.equal(store.getSnapshot().error, 'Offline')
  assert.equal(store.getSnapshot().count, null)
  fail = false
  await store.loadPage()
  assert.equal(store.getSnapshot().error, null)
  assert.equal(store.getSnapshot().items.length, 1)
})

test('late page and count responses cannot replace a newer refresh', async () => {
  const oldCount = deferred(), oldPage = deferred()
  let countCalls = 0, listCalls = 0
  const store = createCustomerServiceEmailImportStore({
    count: () => ++countCalls === 1 ? oldCount.promise : Promise.resolve(1),
    list: () => ++listCalls === 1 ? oldPage.promise : Promise.resolve([item('latest')]),
  })
  const old = store.loadPage()
  await store.loadPage()
  oldCount.resolve(99)
  oldPage.resolve([item('stale')])
  await old
  assert.equal(store.getSnapshot().count, 1)
  assert.equal(store.getSnapshot().items[0].id, 'latest')
})

test('initial counter response cannot overwrite a refreshed open page', async () => {
  const old = deferred()
  let countCalls = 0
  const store = createCustomerServiceEmailImportStore({ count: () => ++countCalls === 1 ? old.promise : Promise.resolve(0),
    list: async () => [] })
  const initial = store.loadCount()
  await store.loadPage()
  old.resolve(50)
  await initial
  assert.equal(store.getSnapshot().count, 0)
})

test('shrinking results clamp the last page after another operator resolves problems', async () => {
  const offsets = []
  const store = createCustomerServiceEmailImportStore({ count: async () => 2,
    list: async ({ offset }) => { offsets.push(offset); return offset === 0 ? [item()] : [] } })
  await store.loadPage(3)
  assert.deepEqual(offsets, [30, 0])
  assert.equal(store.getSnapshot().page, 0)
  assert.equal(store.getSnapshot().items.length, 1)
})

test('rapid detail selection ignores a previous late response and supports records already resolved', async () => {
  const old = deferred()
  const store = createCustomerServiceEmailImportStore({ count: async () => 2, list: async () => [item('first'), item('second')],
    detail: (key) => key === 'first' ? old.promise : Promise.resolve({ id: key, status: 'PROCESSED', requestId: 596 }) })
  await store.loadPage()
  const first = store.selectImport('first')
  await store.selectImport('second')
  old.resolve({ id: 'first' })
  await first
  assert.equal(store.getSnapshot().selectedId, 'second')
  assert.equal(store.getSnapshot().detail.requestId, 596)
})

test('detail failure does not erase the list or count, and retry is read-only', async () => {
  let fail = true
  const store = createCustomerServiceEmailImportStore({ count: async () => 1, list: async () => [item()], detail: async () => {
    if (fail) throw new Error('Read failed')
    return { id }
  } })
  await store.loadPage()
  await store.selectImport(id)
  assert.equal(store.getSnapshot().detailError, 'Read failed')
  assert.equal(store.getSnapshot().count, 1)
  assert.equal(store.getSnapshot().items.length, 1)
  fail = false
  await store.selectImport(id)
  assert.equal(store.getSnapshot().detailError, null)
  assert.equal(store.getSnapshot().detail.id, id)
})

test('closing detail or paging fences pending detail reads', async () => {
  for (const close of [(store) => store.clearSelection(), (store) => store.loadPage()]) {
    const pending = deferred()
    const store = createCustomerServiceEmailImportStore({ count: async () => 1, list: async () => [item()], detail: () => pending.promise })
    await store.loadPage()
    const selection = store.selectImport(id)
    await close(store)
    pending.resolve({ id })
    await selection
    assert.equal(store.getSnapshot().selectedId, null)
    assert.equal(store.getSnapshot().detail, null)
  }
})

test('unmount/sign-out cancels pending notifications and the next actor receives a clean store', async () => {
  const pending = deferred()
  const store = createCustomerServiceEmailImportStore({ count: () => pending.promise })
  let notifications = 0
  const unsubscribe = store.subscribe(() => { notifications += 1 })
  const loading = store.loadCount()
  const notified = notifications
  store.cancelLoads()
  pending.resolve(9)
  await loading
  assert.equal(notifications, notified)
  unsubscribe()
  const nextActor = createCustomerServiceEmailImportStore({ count: async () => 0 })
  assert.equal(nextActor.getSnapshot().count, null)
  await nextActor.loadCount()
  assert.equal(nextActor.getSnapshot().count, 0)
})

test('canceling page/detail reads suppresses late success and late failure', async () => {
  for (const reject of [false, true]) {
    const pending = deferred()
    const store = createCustomerServiceEmailImportStore({ count: async () => 1, list: () => pending.promise })
    const loading = store.loadPage()
    store.cancelLoads()
    const snapshot = store.getSnapshot()
    if (reject) pending.reject(new Error('Late failure'))
    else pending.resolve([item()])
    await loading
    assert.equal(store.getSnapshot(), snapshot)
  }
})

test('unknown selections and invalid pages do not issue reads', async () => {
  const store = createCustomerServiceEmailImportStore({ count: () => assert.fail('Unexpected count'),
    list: () => assert.fail('Unexpected list'), detail: () => assert.fail('Unexpected detail') })
  await store.selectImport('not-in-list')
  await store.loadPage(-1)
  await store.loadPage(NaN)
  await tick()
  assert.equal(store.getSnapshot().selectedId, null)
})
