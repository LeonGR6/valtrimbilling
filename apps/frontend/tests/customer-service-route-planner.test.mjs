import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adjustedStopEndInput,
  buildProposalAdjustments,
  groupServiceScheduleProposals,
} from '../src/features/customer-service/utils/routePlanner.js'

function proposal(overrides = {}) {
  return {
    id: 1,
    technicianId: 9,
    technicianName: 'Ana Rivera',
    proposedOn: '2026-09-29',
    rank: 1,
    stops: [{
      id: 10,
      requestId: 42,
      startsAt: '2026-09-29T16:00:00.000Z',
      endsAt: '2026-09-29T17:30:00.000Z',
    }],
    ...overrides,
  }
}

test('Route Planner groups routes by day and technician, then ranks options', () => {
  const groups = groupServiceScheduleProposals([
    proposal({ id: 3, rank: 2 }),
    proposal({ id: 2, rank: 1 }),
    proposal({
      id: 4,
      technicianId: 10,
      technicianName: 'Ben Ortiz',
      proposedOn: '2026-09-30',
    }),
  ])

  assert.deepEqual(groups.map((group) => group.date), [
    '2026-09-29',
    '2026-09-30',
  ])
  assert.deepEqual(groups[0].technicians[0].proposals.map(({ id }) => id), [2, 3])
})

test('manual route adjustment preserves duration and sends only changed stops', () => {
  const route = proposal()
  const adjustments = buildProposalAdjustments(route, {
    42: '2026-09-29T10:00',
  }, 'America/Los_Angeles')

  assert.deepEqual(adjustments, [{
    requestId: 42,
    startsAt: '2026-09-29T17:00:00.000Z',
    endsAt: '2026-09-29T18:30:00.000Z',
  }])
  assert.equal(
    adjustedStopEndInput(route.stops[0], '2026-09-29T10:00', 'America/Los_Angeles'),
    '2026-09-29T11:30',
  )
})

test('unchanged generated times do not become manual adjustments', () => {
  const route = proposal()
  assert.deepEqual(buildProposalAdjustments(route, {
    42: '2026-09-29T09:00',
  }, 'America/Los_Angeles'), [])
})
