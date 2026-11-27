import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDashboardMetrics,
  localDateKey,
} from '../src/features/dashboard/utils/dashboardMetrics.js'

const now = new Date(2026, 8, 15, 12)

function event(id, start, activityType, dateOwner = 'SUPERVISOR') {
  return {
    id,
    start,
    title: `${activityType} · ${id}`,
    extendedProps: { activityType, dateOwner },
  }
}

function record(id, status, invoiceStatus = 'DRAFT', dueDate = null, netAmount = 0, paidAmount = 0) {
  return {
    id,
    packageNumber: `DP-${id}`,
    status,
    dueDate,
    persistedInvoice: { status: invoiceStatus, netAmount, paidAmount },
  }
}

test('upcoming Production counts scheduled dates once per calendar event and respects the inclusive window', () => {
  const events = [
    event('ext', '2026-09-15', 'EXT', 'TENTATIVE'),
    event('dm-division', '2026-09-21', 'DM'),
    event('hw', '2026-09-22', 'HW'),
    event('past', '2026-09-14', 'EXT'),
  ]
  const result = buildDashboardMetrics(events, [], now, 7)

  assert.equal(result.startKey, '2026-09-15')
  assert.equal(result.endKey, '2026-09-21')
  assert.deepEqual(result.upcomingEvents.map(({ id }) => id), ['ext', 'dm-division'])
  assert.equal(result.tentativeCount, 1)
  assert.deepEqual(result.eventTypeCounts, { EXT: 1, DM: 1 })
  assert.equal(buildDashboardMetrics(events, [], now, 30).upcomingEvents.length, 3)
})

test('collection uses issued unpaid invoice balances and keeps draft and voided amounts out', () => {
  const packages = [
    record(1, 'DRAFT', 'DRAFT', null, 1000),
    record(2, 'AWAITING_PAYMENT', 'ISSUED', '2026-09-14', 100, 20),
    record(3, 'AWAITING_PAYMENT', 'PARTIALLY_PAID', '2026-09-20', 40, 10),
    record(4, 'AWAITING_PAYMENT', 'SUBMITTED', '2026-09-23', 30),
    record(5, 'PAID_CLOSED', 'PAID', '2026-09-15', 50, 50),
    record(6, 'DRAFT', 'VOIDED', '2026-09-15', 500),
  ]
  const result = buildDashboardMetrics([], packages, now, 7)

  assert.equal(result.awaitingPaymentCount, 3)
  assert.deepEqual(result.packageStatusCounts, {
    AWAITING_PAYMENT: 3,
    PAID_CLOSED: 1,
    DRAFT: 2,
  })
  assert.equal(result.pendingBalance, 140)
  assert.deepEqual(result.openInvoices.map(({ id, balance, overdue }) => ({ id, balance, overdue })), [
    { id: 2, balance: 80, overdue: true },
    { id: 3, balance: 30, overdue: false },
    { id: 4, balance: 30, overdue: false },
  ])
})

test('collection aging splits the open balance into overdue, due this week and not yet due', () => {
  const packages = [
    record(1, 'AWAITING_PAYMENT', 'ISSUED', '2026-09-14', 100, 20),
    record(2, 'AWAITING_PAYMENT', 'ISSUED', '2026-09-15', 40),
    record(3, 'AWAITING_PAYMENT', 'ISSUED', '2026-09-21', 10),
    record(4, 'AWAITING_PAYMENT', 'PARTIALLY_PAID', '2026-09-22', 60, 10),
  ]
  const { collectionAging, pendingBalance } = buildDashboardMetrics([], packages, now, 7)

  assert.deepEqual(collectionAging, {
    overdue: { count: 1, balance: 80 },
    dueSoon: { count: 2, balance: 50 },
    notDue: { count: 1, balance: 50 },
  })
  assert.equal(
    collectionAging.overdue.balance + collectionAging.dueSoon.balance + collectionAging.notDue.balance,
    pendingBalance,
  )
})

test('the Production timeline lays a week out by day and longer periods by week', () => {
  const events = [
    event('mon', '2026-09-15', 'EXT'),
    event('mon-dm', '2026-09-15', 'DM', 'TENTATIVE'),
    event('sat', '2026-09-19', 'HW'),
    event('next-week', '2026-09-23', 'SHUTTER'),
    event('far', '2026-10-01', 'EXT'),
  ]

  const week = buildDashboardMetrics(events, [], now, 7).timeline
  assert.equal(week.mode, 'days')
  assert.equal(week.buckets.length, 7)
  assert.deepEqual(week.buckets.map(({ events: dayEvents }) => dayEvents.length), [2, 0, 0, 0, 1, 0, 0])
  assert.deepEqual(week.buckets.map(({ isWeekend }) => isWeekend), [false, false, false, false, true, true, false])
  assert.equal(week.buckets[0].isToday, true)
  assert.deepEqual(week.typeCounts, { EXT: 1, SHUTTER: 0, DM: 1, HW: 1 })

  const month = buildDashboardMetrics(events, [], now, 30).timeline
  assert.equal(month.mode, 'weeks')
  assert.equal(month.buckets.length, 5)
  assert.deepEqual(month.buckets.map(({ total }) => total), [3, 1, 1, 0, 0])
  assert.deepEqual(month.typeCounts, { EXT: 2, SHUTTER: 1, DM: 1, HW: 1 })
  assert.equal(buildDashboardMetrics(events, [], now, 90).timeline.buckets.length, 13)
})

test('date keys use the local calendar day and advance across months', () => {
  assert.equal(localDateKey(now), '2026-09-15')
  assert.equal(buildDashboardMetrics([], [], now, 30).endKey, '2026-10-14')
})
