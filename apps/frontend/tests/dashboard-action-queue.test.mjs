import assert from 'node:assert/strict'
import test from 'node:test'
import { buildActionQueue, summarizeActionQueue } from '../src/features/dashboard/utils/actionQueue.js'

const todayKey = '2026-10-21'
const job = { id: 7, code: '1042', builder: 'Highland Homes', community: 'Willow Creek' }
const jobsById = new Map([['7', job]])

function suggestion(code, cutoffDate, businessDaysRemaining) {
  return {
    job: { ...job, id: code, code },
    cutoffDate,
    businessDaysRemaining,
    isCutoffToday: cutoffDate === todayKey,
    selectionCount: 1,
    isReady: true,
    estimatedInvoiceAmount: 100,
  }
}

function invoice(id, dueDate, balance) {
  return {
    id,
    jobId: 7,
    builderId: 3,
    phaseId: 2,
    packageNumber: `DP-${id}`,
    invoiceNumber: String(15000 + id),
    dueDate,
    balance,
  }
}

function phase(id, createdAt) {
  return {
    key: `7:${id}`,
    job,
    phase: { id, name: '2', building: 'A', createdAt },
    lotCount: 3,
  }
}

test('the queue orders overdue and cutoff-today work first, then soon-due work, then waiting Phases', () => {
  const items = buildActionQueue({
    cutoffSuggestions: [suggestion('1051', '2026-10-23', 2), suggestion('1042', todayKey, 0)],
    openInvoices: [
      invoice(1, '2026-10-14', 7990),
      invoice(2, '2026-10-19', 2160),
      invoice(3, '2026-10-23', 4300),
      invoice(4, '2026-10-28', 9999),
    ],
    unscheduledPhases: [phase(9, '2026-10-16'), phase(8, '2026-10-12')],
    jobsById,
    todayKey,
  })

  assert.deepEqual(items.map(({ id }) => id), [
    'invoice:1',
    'invoice:2',
    'cutoff:1042',
    'cutoff:1051',
    'invoice:3',
    'phase:7:8',
    'phase:7:9',
  ])
  assert.deepEqual(items.map(({ headline }) => headline), [
    '7 days late',
    '2 days late',
    'Cutoff today',
    '2 business days',
    'Due in 2 days',
    '9 days waiting',
    '5 days waiting',
  ])
  assert.deepEqual(items.map(({ tone }) => tone), ['late', 'late', 'soon', 'soon', 'soon', 'wait', 'wait'])
})

test('an invoice due today is not late and invoices beyond the week stay out', () => {
  const items = buildActionQueue({
    openInvoices: [invoice(1, todayKey, 50), invoice(2, '2026-10-28', 80)],
    jobsById,
    todayKey,
  })

  assert.deepEqual(items.map(({ id, headline, tone }) => ({ id, headline, tone })), [
    { id: 'invoice:1', headline: 'Due today', tone: 'soon' },
  ])
})

test('rows link to the Package, the invoice and the Calendar form of the Phase', () => {
  const [late, cutoff, waiting] = buildActionQueue({
    cutoffSuggestions: [suggestion('1042', todayKey, 0)],
    openInvoices: [invoice(1, '2026-10-14', 10)],
    unscheduledPhases: [phase(9, '2026-10-16')],
    jobsById,
    todayKey,
  })

  assert.equal(late.to, '/draw-invoice/builder/3/job/7/phase/2/package/1')
  assert.equal(late.title, 'Invoice 15001')
  assert.equal(cutoff.to, '/draw-invoice#package-suggestions')
  assert.equal(waiting.to, '/calendar?schedule=7%3A9')
  assert.equal(waiting.title, 'Job #1042 · Phase 2 · Building A')
})

test('the summary counts cutoffs, overdue invoices and unscheduled Phases', () => {
  const items = buildActionQueue({
    cutoffSuggestions: [suggestion('1042', todayKey, 0)],
    openInvoices: [invoice(1, '2026-10-14', 10), invoice(2, '2026-10-23', 10)],
    unscheduledPhases: [phase(9, null)],
    jobsById,
    todayKey,
  })

  assert.deepEqual(summarizeActionQueue(items), { cutoffs: 1, overdueInvoices: 1, phases: 1 })
  assert.equal(items.at(-1).headline, 'Not scheduled')
})
