import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPhaseCalendarCoverage,
  getSchedulablePhases,
} from '../src/features/calendar/utils/phaseCalendarCoverage.js'

const lot = (id, extra = {}) => ({ id, lotNumber: String(id), ...extra })

function buildJob(id, overrides = {}) {
  return {
    id,
    code: String(1000 + id),
    builder: 'Acme',
    community: 'Stone Creek',
    isActive: true,
    sequenceSheet: {
      phases: [
        { id: id * 10 + 1, name: '1', building: 'A', lots: [lot(1), lot(2)] },
        { id: id * 10 + 2, name: '2', building: 'B', lots: [lot(3)] },
      ],
    },
    ...overrides,
  }
}

function buildActivity(overrides = {}) {
  return {
    id: 1,
    jobId: 1,
    phaseId: 11,
    status: 'ACTIVE',
    stages: [
      { type: 'EXT', isEnabled: true, schedules: [{ id: 1, date: '2026-10-12', isActive: true }] },
      { type: 'DM', isEnabled: true, schedules: [{ id: 2, date: '2026-10-14', isActive: true }] },
      { type: 'HW', isEnabled: true, schedules: [{ id: 3, date: '2026-10-16', isActive: true }] },
    ],
    ...overrides,
  }
}

const keys = (coverage) => coverage.unscheduled.map(({ key }) => key)

test('a Phase with an active Production activity is on the Calendar', () => {
  const coverage = buildPhaseCalendarCoverage({
    jobs: [buildJob(1)],
    activities: [buildActivity()],
  })

  assert.deepEqual(keys(coverage), ['1:12'])
  const [firstPhase, secondPhase] = buildJob(1).sequenceSheet.phases
  assert.equal(coverage.statusOf(buildJob(1), firstPhase), 'scheduled')
  assert.equal(coverage.statusOf(buildJob(1), secondPhase), 'unscheduled')
  assert.equal(coverage.statusOf(buildJob(1, { isActive: false }), secondPhase), null)
  assert.equal(
    coverage.statusOf(buildJob(1), { id: 99, lots: [lot(1, { isUtilityBuilding: true })] }),
    null,
  )
  assert.equal(coverage.unscheduledCountByJob.get('1'), 1)
})

test('cancelled activities and activities without active dates do not count', () => {
  const coverage = buildPhaseCalendarCoverage({
    jobs: [buildJob(1)],
    activities: [
      buildActivity({ status: 'CANCELLED' }),
      buildActivity({
        id: 2,
        phaseId: 12,
        stages: [
          { type: 'EXT', isEnabled: true, schedules: [{ id: 9, date: '2026-10-12', isActive: false }] },
          { type: 'DM', isEnabled: false, schedules: [{ id: 8, date: '2026-10-14', isActive: true }] },
        ],
      }),
    ],
  })

  assert.deepEqual(keys(coverage), ['1:11', '1:12'])
})

test('inactive Jobs and Phases with only Utility rows are never reported', () => {
  const utilityOnly = buildJob(2)
  utilityOnly.sequenceSheet.phases = [
    { id: 21, name: '1', building: 'A', lots: [lot(1, { isUtilityBuilding: true })] },
    { id: 22, name: '2', building: 'B', lots: [lot(2)] },
  ]
  const coverage = buildPhaseCalendarCoverage({
    jobs: [buildJob(1, { isActive: false }), utilityOnly],
    activities: [],
  })

  assert.deepEqual(keys(coverage), ['2:22'])
  assert.deepEqual(getSchedulablePhases(utilityOnly).map(({ id }) => id), [22])
})

test('unscheduled Phases are sorted by Builder, Community, Job and Phase', () => {
  const jobs = [
    buildJob(2, { builder: 'Zed', code: '1' }),
    buildJob(1, { builder: 'Acme', community: 'Lakes', code: '20' }),
    buildJob(3, { builder: 'Acme', community: 'Lakes', code: '3' }),
  ]
  const coverage = buildPhaseCalendarCoverage({ jobs, activities: [] })

  assert.deepEqual(
    coverage.unscheduled.map(({ job, phase }) => `${job.builder}/${job.code}/${phase.name}`),
    ['Acme/3/1', 'Acme/3/2', 'Acme/20/1', 'Acme/20/2', 'Zed/1/1', 'Zed/1/2'],
  )
  assert.equal(coverage.unscheduled[0].lotCount, 2)
})

test('Calendar links carry the Job and Phase to schedule', async () => {
  const { calendarSchedulePath, parseCalendarSchedule } = await import(
    '../src/features/calendar/utils/calendarRoutes.js'
  )
  const path = calendarSchedulePath(25, 31)

  assert.equal(path, '/calendar?schedule=25%3A31')
  assert.deepEqual(
    parseCalendarSchedule(new URL(path, 'http://x').searchParams.get('schedule')),
    { jobId: 25, phaseId: 31 },
  )
  assert.equal(parseCalendarSchedule('25'), null)
  assert.equal(parseCalendarSchedule('a:b'), null)
  assert.equal(parseCalendarSchedule(null), null)
})
