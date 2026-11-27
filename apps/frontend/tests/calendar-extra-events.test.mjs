import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXTRA_EVENT_VARIANTS,
  extraEventKey,
  extraEventLabel,
  extraEventParentStage,
  isExtraEventVariant,
  removeExtraEventFromDraft,
} from '../src/features/calendar/utils/calendarExtraEvents.js'
import { createEmptyProductionDraft } from '../src/features/calendar/data/calendarEvents.js'
import { toProductionActivityRpc } from '../src/features/calendar/services/productionActivityRecord.js'
import { calendarEventSchema } from '../src/features/calendar/schemas/calendarEventSchema.js'

function draftWithEveryExtra() {
  return {
    ...createEmptyProductionDraft('2026-09-10'),
    activityId: 77,
    jobId: 9,
    phaseId: 21,
    jobCode: '1307',
    builder: 'Builder',
    community: 'Community',
    phase: 'Phase 1',
    building: 'A',
    lotStart: 1,
    lotEnd: 2,
    lotNumbers: ['1', '2'],
    lotIds: [101, 102],
    extDateOwner: 'SUPERVISOR',
    extInstallOnly: true,
    extInstallDate: '2026-09-12',
    extInstallDateOwner: 'SUPERVISOR',
    extInstallDateNote: 'ext install',
    extInstallScheduleId: 11,
    dmDate: '2026-10-08',
    dmDateOwner: 'TENTATIVE',
    dmInstallOnly: true,
    dmInstallDate: '2026-10-10',
    dmInstallDateOwner: 'SUPERVISOR',
    dmInstallDateNote: 'dm install',
    dmInstallScheduleId: 12,
    dmBaseboardInstall: true,
    dmBaseboardInstallDate: '2026-10-12',
    dmBaseboardInstallDateOwner: 'SUPERVISOR',
    dmBaseboardInstallDateNote: 'after paint',
    dmBaseboardInstallScheduleId: 13,
    hwDate: '2026-10-15',
    hwDateOwner: 'TENTATIVE',
    hwLockUp: true,
    hwLockUpDate: '2026-10-16',
    hwLockUpDateOwner: 'TENTATIVE',
    hwLockUpDateNote: 'lock',
    hwLockUpScheduleId: 14,
  }
}

const variants = (payload, stage) => payload.p_stages
  .find((item) => item.type === stage).schedules.map((schedule) => schedule.variant)

test('only Shutter, install only, baseboard install, lock up and weatherstripping are extra events', () => {
  assert.deepEqual(EXTRA_EVENT_VARIANTS, ['shutter', 'install-only', 'baseboard-install', 'lock-up', 'weatherstripping'])
  for (const variant of EXTRA_EVENT_VARIANTS) assert.equal(isExtraEventVariant(variant), true)
  for (const variant of ['base', 'division', undefined, null, 'toString']) {
    assert.equal(isExtraEventVariant(variant), false)
    assert.equal(extraEventLabel(variant), null)
  }
  assert.equal(extraEventLabel('baseboard-install'), 'Baseboard install')
})

test('removing a baseboard install takes only it off the activity', () => {
  const draft = draftWithEveryExtra()
  const next = removeExtraEventFromDraft(draft, 'baseboard-install', 'DM')
  const payload = toProductionActivityRpc(next)

  assert.deepEqual(variants(payload, 'DM'), ['BASE', 'INSTALL_ONLY'])
  // The other extras and the main dates are untouched.
  assert.deepEqual(variants(payload, 'EXT'), ['BASE', 'INSTALL_ONLY'])
  assert.deepEqual(variants(payload, 'HW'), ['BASE', 'LOCK_UP'])
  assert.equal(next.dmDate, '2026-10-08')
  assert.equal(next.dmInstallDate, '2026-10-10')
  assert.equal(next.dmBaseboardInstall, false)
  assert.equal(next.dmBaseboardInstallDate, '')
  assert.equal(next.dmBaseboardInstallDateNote, '')
  // It still saves: the schema accepts the activity without that event.
  assert.equal(calendarEventSchema.safeParse(next).success, true)
  // The original draft is not changed.
  assert.equal(draft.dmBaseboardInstall, true)
})

test('install only is removed from the stage it belongs to', () => {
  const draft = draftWithEveryExtra()

  const noDmInstall = toProductionActivityRpc(removeExtraEventFromDraft(draft, 'install-only', 'DM'))
  assert.deepEqual(variants(noDmInstall, 'DM'), ['BASE', 'BASEBOARD_INSTALL'])
  assert.deepEqual(variants(noDmInstall, 'EXT'), ['BASE', 'INSTALL_ONLY'])

  const noExtInstall = toProductionActivityRpc(removeExtraEventFromDraft(draft, 'install-only', 'EXT'))
  assert.deepEqual(variants(noExtInstall, 'EXT'), ['BASE'])
  assert.deepEqual(variants(noExtInstall, 'DM'), ['BASE', 'INSTALL_ONLY', 'BASEBOARD_INSTALL'])
})

test('removing a lock up leaves the Hardware date', () => {
  const next = removeExtraEventFromDraft(draftWithEveryExtra(), 'lock-up', 'HW')

  assert.deepEqual(variants(toProductionActivityRpc(next), 'HW'), ['BASE'])
  assert.equal(next.hwDate, '2026-10-15')
  assert.equal(next.hwLockUp, false)
  assert.equal(next.hwLockUpDate, '')
})

test('a main event is never changed by the removal helper', () => {
  const draft = draftWithEveryExtra()
  assert.equal(removeExtraEventFromDraft(draft, 'base', 'DM'), draft)
  assert.equal(removeExtraEventFromDraft(draft, 'division', 'HW'), draft)
})

test('a weatherstripping is one more HW schedule for every lot, and can be taken off alone', () => {
  const draft = {
    ...draftWithEveryExtra(),
    hwWeatherstripping: true,
    hwWeatherstrippingDate: '2026-10-17',
    hwWeatherstrippingDateOwner: 'SUPERVISOR',
    hwWeatherstrippingDateNote: 'doors',
    hwWeatherstrippingScheduleId: 15,
    hwWeatherstrippingConfirmed: true,
  }
  const payload = toProductionActivityRpc(draft)
  const hw = payload.p_stages.find((item) => item.type === 'HW')

  assert.deepEqual(variants(payload, 'HW'), ['BASE', 'LOCK_UP', 'WEATHERSTRIPPING'])
  assert.deepEqual(hw.schedules.at(-1), {
    id: 15,
    variant: 'WEATHERSTRIPPING',
    date: '2026-10-17',
    dateOwner: 'SUPERVISOR',
    note: 'doors',
    lotIds: [101, 102],
    confirmed: true,
  })
  assert.equal(extraEventLabel('weatherstripping'), 'Weatherstripping')

  const without = removeExtraEventFromDraft(draft, 'weatherstripping', 'HW')
  assert.deepEqual(variants(toProductionActivityRpc(without), 'HW'), ['BASE', 'LOCK_UP'])
  assert.equal(without.hwLockUp, true)
  assert.equal(without.hwWeatherstrippingDate, '')
  assert.equal(without.hwWeatherstrippingConfirmed, false)
})

test('a checked weatherstripping needs its date', () => {
  const result = calendarEventSchema.safeParse({
    ...draftWithEveryExtra(),
    hwWeatherstripping: true,
    hwWeatherstrippingDate: '',
    hwWeatherstrippingDateOwner: 'SUPERVISOR',
  })

  assert.equal(result.success, false)
  assert.ok(result.error.issues.some((issue) => issue.path[0] === 'hwWeatherstrippingDate'))
})

test('EXT, DM and HW are never an extra event; Shutter and the variants are', () => {
  for (const activityType of ['EXT', 'DM', 'HW']) {
    assert.equal(extraEventKey({ activityType, variant: 'base' }), null)
    assert.equal(extraEventKey({ activityType, variant: 'division' }), null)
  }
  assert.equal(extraEventKey({ activityType: 'SHUTTER', variant: 'base' }), 'shutter')
  assert.equal(extraEventKey({ activityType: 'DM', variant: 'baseboard-install' }), 'baseboard-install')
  assert.equal(extraEventKey({ activityType: 'HW', variant: 'weatherstripping' }), 'weatherstripping')
  assert.equal(extraEventLabel(extraEventKey({ activityType: 'SHUTTER', variant: 'base' })), 'Shutter')
  assert.equal(extraEventParentStage({ activityType: 'SHUTTER', variant: 'base' }), 'DM')
  assert.equal(extraEventParentStage({ activityType: 'HW', variant: 'lock-up' }), 'HW')
})

test('removing the Shutter takes only it off: EXT, DM, HW and the other extras stay', () => {
  const draft = {
    ...draftWithEveryExtra(),
    dmShutters: true,
    shutterDate: '2026-10-01',
    shutterDateOwner: 'SUPERVISOR',
    shutterDateNote: 'blinds',
    shutterScheduleId: 16,
    shutterConfirmed: true,
  }
  assert.ok(toProductionActivityRpc(draft).p_stages.some((stage) => stage.type === 'SHUTTER'))

  const next = removeExtraEventFromDraft(draft, 'shutter', 'SHUTTER')
  const payload = toProductionActivityRpc(next)

  assert.deepEqual(payload.p_stages.map((stage) => stage.type), ['EXT', 'DM', 'HW'])
  assert.deepEqual(variants(payload, 'DM'), ['BASE', 'INSTALL_ONLY', 'BASEBOARD_INSTALL'])
  assert.deepEqual(variants(payload, 'HW'), ['BASE', 'LOCK_UP'])
  assert.equal(next.dmShutters, false)
  assert.equal(next.shutterDate, '')
  assert.equal(next.shutterConfirmed, false)
  assert.equal(next.dmDate, draft.dmDate)
  assert.equal(calendarEventSchema.safeParse(next).success, true)
})
