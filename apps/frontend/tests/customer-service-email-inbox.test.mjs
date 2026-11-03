import test from 'node:test'
import assert from 'node:assert/strict'
import { createCustomerServiceEmailInboxRepository, toEmailInboxItem, toEmailInboxCounts } from '../src/features/customer-service/services/customerServiceEmailInboxRepository.js'
import { createCustomerServiceEmailInboxStore } from '../src/features/customer-service/context/customerServiceEmailInboxStore.js'
import { canRetryInboxItem, emailInboxItemState, emailInboxReason, emailInboxRequestStage, emailInboxReviewLabel } from '../src/features/customer-service/utils/emailInboxPresentation.js'

const id = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const stamp = '2026-11-02T17:00:00Z'
const row = (extra = {}) => ({ id, sourceKind: 'IMPORT', state: 'REQUIRES_ACTION', reasonCode: 'ANALYSIS_INCOMPLETE',
  subject: 'Real warranty email', sender: { emailAddress: { name: 'Builder', address: 'builder@example.com' } },
  createdAt: stamp, updatedAt: stamp, importUpdatedAt: stamp, importStatus: 'NEEDS_ATTENTION', sourceStatus: 'AVAILABLE',
  resolutionVersion: 0, requestId: null, requestFolio: null, ...extra })
const counts = (requiresAction = 1, registered = 0) => ({ requiresAction, registered, processing: 0, unmatched: 0, importIssues: requiresAction,
  total: requiresAction + registered, revision: `${requiresAction}:${registered}` })
const success = (extra = {}) => toEmailInboxItem(row({ state: 'REGISTERED', importStatus: 'PROCESSED',
  requestId: 1031, requestFolio: 'CS-2031', requestWorkflowStage: 'NEEDS_REVIEW', reasonCode: null, ...extra }))
function fixture() {
  let item = toEmailInboxItem(row())
  let failRead = false, failCounts = false
  const calls = []
  const repository = {
    count: async () => { if (failCounts) throw new Error('Count unavailable'); return item.state === 'REGISTERED' ? counts(0, 1) : counts() },
    list: async ({ state }) => { calls.push('list'); return !state || state === item.state ? [item] : [] },
    read: async () => { calls.push('read'); if (failRead) throw new Error('Read unavailable'); return item },
    retry: async () => { calls.push('retry'); item = success(); return { requestId: 1031, status: 'PROCESSED' } },
    confirm: async () => { calls.push('confirm'); item = success({ sourceKind: 'FOLDER_MESSAGE' }); return { requestId: 1031, state: 'REGISTERED' } },
  }
  return { repository, calls, store: createCustomerServiceEmailInboxStore(repository),
    get item() { return item }, set item(value) { item = value },
    set failRead(value) { failRead = value }, set failCounts(value) { failCounts = value } }
}
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

test('inbox projection includes readable metadata and strips bodies, binary transport, provider IDs and leases', () => {
  const item = toEmailInboxItem(row({ provider_message_id: 'PRIVATE', body: 'BODY', bytes: [1], worker_token: 'PRIVATE',
    sender: { emailAddress: { name: 'Builder', address: 'b@example.com', contentBytes: 'PRIVATE' } } }))
  assert.equal(item.sender, 'Builder · b@example.com')
  assert.equal(JSON.stringify(item).includes('PRIVATE'), false)
  assert.equal(JSON.stringify(item).includes('BODY'), false)
  assert.equal(toEmailInboxItem(row({ subject: null })).subject, 'Subject not yet available')
})
test('a registered badge requires an actual request ID and folio, and malformed counters stay unknown', () => {
  for (const invalid of [row({ state: 'REGISTERED' }), row({ state: 'REGISTERED', requestId: 1031 }), row({ state: 'WRONG' }), row({ resolutionVersion: -1 })]) {
    assert.throws(() => toEmailInboxItem(invalid), /confirmed/)
  }
  for (const invalid of [null, { ...counts(), total: 20 }, { ...counts(), requiresAction: '1' },
    { ...counts(), unmatched: 1 }, { ...counts(), importIssues: undefined }, { ...counts(), unmatched: -1 }]) assert.throws(() => toEmailInboxCounts(invalid))
})

test('two unmatched originals are emails to match, not two failed requests; real import issues remain visible', () => {
  const totals = toEmailInboxCounts({ ...counts(2, 3), unmatched: 2, importIssues: 0 })
  assert.equal(emailInboxReviewLabel(totals), 'View emails · 2 to match')
  assert.deepEqual(emailInboxItemState(row({ sourceKind: 'FOLDER_MESSAGE', reasonCode: 'NO_IMPORT' })),
    { label: 'Unmatched email', color: 'info' })
  assert.deepEqual(emailInboxItemState(row()), { label: 'Import issue', color: 'warning' })
  assert.deepEqual(emailInboxItemState(row({ sourceKind: 'FOLDER_MESSAGE', reasonCode: 'LINKED_REQUEST_REMOVED' })),
    { label: 'Request link missing', color: 'warning' })
  assert.equal(emailInboxReviewLabel({ ...totals, requiresAction: 3, importIssues: 1 }), 'View emails · 2 to match · 1 import issue')
  assert.equal(emailInboxReviewLabel(counts(0, 3)), 'View emails · no pending review')
  assert.equal(emailInboxReviewLabel(null), 'View emails · — to review')
})

test('matching reads and captures the current version without selecting a target or mutating', async () => {
  const f = fixture()
  const stale = toEmailInboxItem(row({ sourceKind: 'FOLDER_MESSAGE', reasonCode: 'NO_IMPORT', resolutionVersion: 1 }))
  f.item = { ...stale, resolutionVersion: 3 }
  assert.equal((await f.store.select(stale)).resolutionVersion, 3)
  assert.deepEqual(f.calls, ['read'])
  f.failRead = true
  assert.equal(await f.store.select(stale), null)
  assert.equal(f.store.getSnapshot().selected, null)
  const read = deferred()
  f.repository.read = () => read.promise
  const selection = f.store.select(stale)
  f.store.clearSelection()
  read.resolve(f.item)
  assert.equal(await selection, null)
  assert.equal(f.store.getSnapshot().selected, null)
})

test('stored diagnostic text is rendered as English product copy, preserving original email metadata', () => {
  const item = toEmailInboxItem(row({ subject: 'Solicitud original', errorMessage: 'Error interno PRIVATE_TOKEN' }))
  assert.equal(item.subject, 'Solicitud original')
  assert.equal(item.errorMessage, 'Required details are missing to create the request')
  assert.doesNotMatch(JSON.stringify(item), /PRIVATE_TOKEN|Error interno/)
})
test('read and confirmation use opaque identities, exact target and the version the user reviewed', async () => {
  const calls = []
  const item = toEmailInboxItem(row({ sourceKind: 'FOLDER_MESSAGE', reasonCode: 'NO_IMPORT', resolutionVersion: 2 }))
  const repository = createCustomerServiceEmailInboxRepository({ getClient: async () => ({ rpc: async (name, args) => {
    calls.push({ name, args })
    return { data: name.startsWith('confirm_') ? { id, state: 'REGISTERED', requestId: 1031, requestFolio: 'CS-2031' } : row({ sourceKind: 'FOLDER_MESSAGE' }) }
  } }) })
  await repository.read(item)
  await repository.confirm(item, 1031)
  assert.deepEqual(calls, [
    { name: 'read_customer_service_email_inbox_item', args: { p_source_kind: 'FOLDER_MESSAGE', p_id: id } },
    { name: 'confirm_customer_service_email_request', args: { p_message_id: id, p_request_id: 1031, p_expected_version: 2 } },
  ])
})
test('wrong confirmations, missing items and mixed-state/duplicate lists cannot be presented as success', async () => {
  for (const data of [null, row({ id: otherId }), { id, state: 'REGISTERED', requestId: 77, requestFolio: 'CS-1077' }]) {
    const repository = createCustomerServiceEmailInboxRepository({ getClient: async () => ({ rpc: async () => ({ data }) }) })
    await assert.rejects(repository.read(toEmailInboxItem(row())))
    await assert.rejects(repository.confirm(toEmailInboxItem(row({ sourceKind: 'FOLDER_MESSAGE' })), 1031))
  }
  for (const data of [[row(), row()], [row({ state: 'PROCESSING' })]]) {
    const repository = createCustomerServiceEmailInboxRepository({ getClient: async () => ({ rpc: async () => ({ data }) }) })
    await assert.rejects(repository.list({ state: 'REQUIRES_ACTION' }))
  }
})
test('permission and stale errors are actionable and never expose raw server diagnostics', async () => {
  for (const code of ['42501', '40001', '55000', 'P0002', 'OTHER']) {
    const repository = createCustomerServiceEmailInboxRepository({ getClient: async () => ({ rpc: async () => ({ error: { code, message: 'PRIVATE_TOKEN' } }) }) })
    await assert.rejects(repository.count(), (error) => !error.message.includes('PRIVATE_TOKEN'))
  }
})
test('successful retry verifies stored state, clears pending counters and keeps the visible success/folio', async () => {
  const f = fixture()
  await f.store.refresh()
  await f.store.select(f.item)
  f.calls.length = 0
  await f.store.act('RETRY', f.item)
  assert.deepEqual(f.calls.slice(0, 2), ['retry', 'read'])
  assert.equal(f.store.getSnapshot().result.requestFolio, 'CS-2031')
  assert.equal(f.store.getSnapshot().result.requestWorkflowStage, 'NEEDS_REVIEW')
  assert.equal(f.store.getSnapshot().counts.requiresAction, 0)
  assert.equal(f.store.getSnapshot().items.length, 0)
  assert.equal(f.store.getSnapshot().selected.state, 'REGISTERED')
})
test('a worker success response with an unconfirmed stored result never shows a green registered result', async () => {
  const f = fixture()
  f.repository.retry = async () => ({ requestId: 1031, status: 'PROCESSED' })
  await f.store.act('RETRY', f.item)
  assert.equal(f.store.getSnapshot().result.state, 'REQUIRES_ACTION')
  f.failRead = true
  await f.store.act('RETRY', f.item)
  assert.equal(f.store.getSnapshot().result, null)
  assert.match(f.store.getSnapshot().actionError, /could not be checked/)
})
test('a lost confirmation response is reconciled by reading its durable result without repeating the mutation', async () => {
  const f = fixture()
  f.item = toEmailInboxItem(row({ sourceKind: 'FOLDER_MESSAGE', reasonCode: 'NO_IMPORT' }))
  let mutations = 0
  f.repository.confirm = async () => { mutations++; f.item = success({ sourceKind: 'FOLDER_MESSAGE' }); throw new Error('Network response lost') }
  await f.store.act('CONFIRM', f.item, 1031)
  assert.equal(f.store.getSnapshot().actionError, null)
  assert.equal(f.store.getSnapshot().result.requestId, 1031)
  assert.equal(mutations, 1)
})
test('a competing confirmed target is shown as changed, never as the target the user selected', async () => {
  const f = fixture()
  f.repository.confirm = async () => { f.item = success({ sourceKind: 'FOLDER_MESSAGE', requestId: 77, requestFolio: 'CS-1077' }); throw new Error('Conflict') }
  await f.store.act('CONFIRM', f.item, 1031)
  assert.equal(f.store.getSnapshot().result, null)
  assert.match(f.store.getSnapshot().actionError, /another request/)
  assert.equal(f.store.getSnapshot().selected.requestId, 77)
})
test('a counter refresh failure preserves verified success while counters remain unknown', async () => {
  const f = fixture()
  f.failCounts = true
  await f.store.act('RETRY', f.item)
  assert.equal(f.store.getSnapshot().result.requestFolio, 'CS-2031')
  assert.equal(f.store.getSnapshot().counts, null)
  assert.equal(f.store.getSnapshot().error, 'Count unavailable')
})
test('automatic completion refreshes a selected pending detail and replaces it with the stored success', async () => {
  const f = fixture()
  await f.store.select(f.item)
  f.item = success()
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().selected.state, 'REGISTERED')
  assert.equal(f.store.getSnapshot().result.requestFolio, 'CS-2031')
})

test('refreshing an initially unconfirmed action clears its old warning once the stored result is available', async () => {
  const f = fixture()
  let retries = 0
  f.repository.retry = async () => { retries++; f.item = success(); f.failRead = true }
  await f.store.act('RETRY', f.item)
  assert.equal(f.store.getSnapshot().result, null)
  assert.match(f.store.getSnapshot().actionError, /could not be checked/)
  f.failRead = false
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().result.requestFolio, 'CS-2031')
  assert.equal(f.store.getSnapshot().actionError, null)
  assert.equal(f.store.getSnapshot().unconfirmedAction, null)
  assert.equal(retries, 1)
})
test('a pending continuation remains processing and a later removed link removes stale success', async () => {
  const f = fixture()
  f.repository.retry = async () => { f.item = toEmailInboxItem(row({ state: 'PROCESSING', importStatus: 'PENDING' })) }
  await f.store.act('RETRY', f.item)
  assert.equal(f.store.getSnapshot().result.state, 'PROCESSING')
  f.item = success()
  await f.store.refresh()
  f.item = toEmailInboxItem(row({ reasonCode: 'LINKED_REQUEST_REMOVED' }))
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().result.state, 'REQUIRES_ACTION')
})
test('repeated clicks cannot overlap a paid retry and canceled account loads cannot publish results', async () => {
  const f = fixture()
  const wait = deferred()
  let mutations = 0
  f.repository.retry = async () => { mutations++; await wait.promise; f.item = success() }
  const first = f.store.act('RETRY', f.item)
  assert.equal(await f.store.act('RETRY', f.item), null)
  f.store.cancelLoads()
  wait.resolve()
  await first
  assert.equal(mutations, 1)
  assert.equal(f.store.getSnapshot().result, null)
})
test('late page responses cannot replace a newer filter and an empty final page clamps safely', async () => {
  const f = fixture()
  const wait = deferred()
  f.repository.list = ({ state }) => state === 'PROCESSING' ? wait.promise : Promise.resolve([])
  const first = f.store.refresh('PROCESSING')
  await f.store.refresh('REGISTERED')
  wait.resolve([toEmailInboxItem(row({ state: 'PROCESSING' }))])
  await first
  assert.equal(f.store.getSnapshot().filter, 'REGISTERED')
  assert.deepEqual(f.store.getSnapshot().items, [])
  await f.store.refresh('REQUIRES_ACTION', 5)
  assert.equal(f.store.getSnapshot().page, 0)
})
test('retry availability honors due time and successful import state stays distinct from human review', () => {
  const now = Date.parse(stamp)
  assert.equal(canRetryInboxItem(toEmailInboxItem(row()), now), true)
  assert.equal(canRetryInboxItem(toEmailInboxItem(row({ nextAttemptAt: '2026-11-02T18:00:00Z' })), now), false)
  assert.equal(canRetryInboxItem(success(), now), false)
  assert.equal(canRetryInboxItem(toEmailInboxItem(row({ sourceKind: 'FOLDER_MESSAGE' })), now), false)
  assert.equal(emailInboxRequestStage('NEEDS_REVIEW'), 'Awaiting human review')
  assert.match(emailInboxReason(toEmailInboxItem(row({ sourceKind: 'FOLDER_MESSAGE', reasonCode: 'NO_IMPORT' }))), /match it to that request/)
})
