import test from 'node:test'
import assert from 'node:assert/strict'
import { createCustomerServiceEmailAutomationMonitor, emailAutomationDispatchErrors, emailAutomationMessage } from '../src/features/customer-service/services/customerServiceEmailAutomation.js'

function fixture() {
  let revision = '1:a'
  let visible = true
  let fail = false
  let reloadFails = false
  let reads = 0
  let loads = 0
  const statuses = []
  const errors = []
  const timers = new Map()
  let sequence = 0
  const monitor = createCustomerServiceEmailAutomationMonitor({
    readStatus: async () => { reads++; if (fail) throw new Error('private error'); return { requestRevision: revision } },
    reloadRequests: async () => { loads++; return reloadFails ? undefined : [] },
    onStatus: (s) => statuses.push(s), onError: (e) => errors.push(e), visible: () => visible,
    schedule: (run, delay) => { assert.equal(delay, 60_000); const id = ++sequence; timers.set(id, run); return id },
    cancel: (id) => timers.delete(id),
  })
  return { monitor, statuses, errors, timers,
    get reads() { return reads }, get loads() { return loads },
    set revision(value) { revision = value }, set visible(value) { visible = value },
    set fail(value) { fail = value }, set reloadFails(value) { reloadFails = value },
  }
}
test('Minute status polling reloads full requests only when the revision changes', async () => {
  const f = fixture()
  await f.monitor.refresh()
  assert.equal(f.loads, 1)
  await f.monitor.refresh()
  assert.equal(f.reads, 2)
  assert.equal(f.loads, 1)
  f.revision = '2:b'
  await f.monitor.refresh()
  assert.equal(f.loads, 2)
  assert.equal(f.timers.size, 1)
  f.monitor.stop()
  assert.equal(f.timers.size, 0)
})
test('Hidden tabs and stopped monitors make no request', async () => {
  const f = fixture()
  f.visible = false
  await f.monitor.refresh()
  assert.equal(f.reads, 0)
  f.visible = true
  await f.monitor.refresh()
  f.monitor.stop()
  await f.monitor.refresh()
  assert.equal(f.reads, 1)
})
test('Failed status read remains visible and still permits the initial list load', async () => {
  const f = fixture()
  f.fail = true
  await f.monitor.refresh()
  assert.equal(f.loads, 1)
  assert.match(f.errors.at(-1), /could not be checked/)
  assert.equal(f.errors.at(-1).includes('private error'), false)
  await f.monitor.refresh()
  assert.equal(f.loads, 1)
  f.fail = false
  await f.monitor.refresh()
  assert.equal(f.errors.at(-1), null)
})
test('A failed list refresh is retried even if its revision is unchanged', async () => {
  const f = fixture()
  f.reloadFails = true
  await f.monitor.refresh()
  f.reloadFails = false
  await f.monitor.refresh()
  assert.equal(f.loads, 2)
})
test('Focus and minute ticks cannot overlap or publish after disposal', async () => {
  let resolve
  let reads = 0
  let published = 0
  const monitor = createCustomerServiceEmailAutomationMonitor({
    readStatus: () => { reads++; return new Promise((r) => { resolve = r }) },
    reloadRequests: async () => [], onStatus: () => { published++ }, onError: () => {},
  })
  const pending = monitor.refresh()
  await monitor.refresh()
  assert.equal(reads, 1)
  monitor.stop()
  resolve({ requestRevision: 'new' })
  await pending
  assert.equal(published, 0)
})
test('Connection status distinguishes pause/stalls/technical failures while email outcomes belong to the inbox', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  const active = { configured: true, enabled: true, lastTickAt: '2026-10-30T11:59:30Z' }
  assert.match(emailAutomationMessage({ configured: false }, now).text, /not configured/)
  assert.match(emailAutomationMessage({ ...active, enabled: false }, now).text, /paused/)
  assert.equal(emailAutomationMessage(active, now).severity, 'success')
  assert.equal(emailAutomationMessage({ ...active, lastTickAt: '2026-10-30T11:50:00Z' }, now).severity, 'warning')
  assert.equal(emailAutomationMessage({ ...active, dispatches: [{ errorCode: 'HTTP_TIMEOUT' }] }, now).severity, 'warning')
  assert.equal(emailAutomationMessage({ ...active, missingCount: 2 }, now).severity, 'success')
  assert.match(emailAutomationMessage({ ...active, problemCount: 1 }, now).text, /individual email results/)
})

test('A successful manual retry stops presenting the old worker business failure as active', () => {
  const now = Date.parse('2026-11-02T17:21:00Z')
  const status = { configured: true, enabled: true, lastTickAt: '2026-11-02T17:20:30Z',
    problemCount: 1, dispatches: [{ kind: 'WORKER', errorCode: 'IMPORT_NEEDS_ATTENTION', httpStatus: 200 }] }
  assert.equal(emailAutomationMessage(status, now).severity, 'success')
  assert.equal(emailAutomationDispatchErrors(status).length, 0)
  const resolved = { ...status, problemCount: 0 }
  assert.equal(emailAutomationMessage(resolved, now).severity, 'success')
  assert.deepEqual(emailAutomationDispatchErrors(resolved), [])
  assert.equal(status.dispatches[0].errorCode, 'IMPORT_NEEDS_ATTENTION')
})

test('Business outcomes do not mask current technical connection errors', () => {
  const now = Date.parse('2026-11-02T17:21:00Z')
  const status = { configured: true, enabled: true, lastTickAt: '2026-11-02T17:20:30Z',
    problemCount: 0, missingCount: 2,
    dispatches: [{ kind: 'WORKER', errorCode: 'IMPORT_NEEDS_ATTENTION' }] }
  assert.match(emailAutomationMessage(status, now).text, /Outlook connected/)
  for (const error of [
    { kind: 'WORKER', errorCode: 'HTTP_TIMEOUT' },
    { kind: 'SYNC', errorCode: 'IMPORT_NEEDS_ATTENTION' },
    { kind: 'RECONCILE', errorCode: 'HTTP_ERROR' },
  ]) {
    const failed = { ...status, dispatches: [...status.dispatches, error] }
    assert.deepEqual(emailAutomationDispatchErrors(failed), [error])
    assert.match(emailAutomationMessage(failed, now).text, /automatic Outlook connection/)
  }
})

test('An unknown problem count cannot hide worker technical failures', () => {
  const dispatch = { kind: 'WORKER', errorCode: 'HTTP_TIMEOUT' }
  for (const problemCount of [undefined, null, '0', -1, 1]) {
    assert.deepEqual(emailAutomationDispatchErrors({ problemCount, dispatches: [dispatch] }), [dispatch])
  }
  assert.deepEqual(emailAutomationDispatchErrors(null), [])
})
