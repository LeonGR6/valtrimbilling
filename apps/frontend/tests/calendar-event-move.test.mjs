import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeDateChanges,
  moveEventInDraft,
} from '../src/features/calendar/utils/calendarEventMove.js'

const configuration = { extToDmWeeks: 4, shutterBeforeDmWeeks: 1, dmToHwWeeks: 1 }

const draft = {
  extDate: '2026-05-04',
  dmDate: '2026-06-01',
  hwDate: '2026-06-08',
  shutterDate: '',
  dmShutters: false,
  extInstallDate: '2026-05-05',
  dmInstallDate: '',
  dmBaseboardInstallDate: '2026-06-03',
  hwLockUpDate: '2026-06-15',
  dmSplitParts: [],
  hwSplitParts: [
    { id: 'a', scheduleId: 11, lotStart: 1, lotEnd: 4, date: '2026-06-08' },
    { id: 'b', scheduleId: 12, lotStart: 5, lotEnd: 9, date: '2026-06-08' },
  ],
}

test('dropping a plain event moves its date by the same rules as the form', () => {
  const plain = { ...draft, hwSplitParts: [] }
  const moved = moveEventInDraft({
    draft: plain,
    props: { activityType: 'HW', variant: 'base' },
    newDate: '2026-06-10',
    configuration,
  })

  assert.equal(moved.hwDate, '2026-06-10')
  assert.equal(moved.dmDate, plain.dmDate)
  assert.deepEqual(
    describeDateChanges(plain, moved).map(({ label, from, to }) => [label, from, to]),
    [['HW', '2026-06-08', '2026-06-10']],
  )
})

test('moving EXT carries DM and HW after it, and the changes say so', () => {
  const moved = moveEventInDraft({
    draft,
    props: { activityType: 'EXT', variant: 'base' },
    newDate: '2026-05-11',
    configuration,
  })

  const labels = describeDateChanges(draft, moved).map((change) => change.label)
  assert.equal(moved.extDate, '2026-05-11')
  assert.ok(labels.includes('EXT') && labels.includes('DM') && labels.includes('HW'))
})

test('install only and lock up events move only their own date', () => {
  const install = moveEventInDraft({
    draft,
    props: { activityType: 'EXT', variant: 'install-only' },
    newDate: '2026-05-06',
    configuration,
  })
  assert.deepEqual(
    describeDateChanges(draft, install).map(({ label }) => label),
    ['EXT install only'],
  )

  const lockUp = moveEventInDraft({
    draft,
    props: { activityType: 'HW', variant: 'lock-up' },
    newDate: '2026-06-16',
    configuration,
  })
  assert.equal(lockUp.hwLockUpDate, '2026-06-16')
  assert.equal(lockUp.hwDate, draft.hwDate)
})

test('a division moves only the part it belongs to', () => {
  const moved = moveEventInDraft({
    draft,
    props: { activityType: 'HW', variant: 'division', scheduleId: 12, lotStart: 5, lotEnd: 9 },
    newDate: '2026-06-12',
    configuration,
  })

  assert.deepEqual(moved.hwSplitParts.map((part) => part.date), ['2026-06-08', '2026-06-12'])
  assert.deepEqual(
    describeDateChanges(draft, moved).map(({ label }) => label),
    ['HW division 2'],
  )

  // A part not saved yet is found by its lots.
  const byLots = moveEventInDraft({
    draft,
    props: { activityType: 'HW', variant: 'division', scheduleId: null, lotStart: 1, lotEnd: 4 },
    newDate: '2026-06-09',
    configuration,
  })
  assert.equal(byLots.hwSplitParts[0].date, '2026-06-09')
})

test('a drop that matches nothing leaves the draft as it was', () => {
  const same = moveEventInDraft({
    draft,
    props: { activityType: 'HW', variant: 'division', scheduleId: 99, lotStart: 50, lotEnd: 60 },
    newDate: '2026-06-12',
    configuration,
  })
  assert.equal(same, draft)
  assert.deepEqual(describeDateChanges(draft, same), [])
})

test('a baseboard install event moves only its own date', () => {
  const moved = moveEventInDraft({
    draft,
    props: { activityType: 'DM', variant: 'baseboard-install' },
    newDate: '2026-06-05',
    configuration,
  })

  assert.equal(moved.dmBaseboardInstallDate, '2026-06-05')
  assert.equal(moved.dmDate, draft.dmDate)
  assert.deepEqual(
    describeDateChanges(draft, moved).map(({ label }) => label),
    ['DM baseboard install'],
  )
})
