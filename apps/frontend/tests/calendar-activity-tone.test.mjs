import test from 'node:test'
import assert from 'node:assert/strict'
import { getActivityTone } from '../src/features/calendar/data/calendarEvents.js'

test('a DM with a Tentative date is orange', () => {
  assert.equal(getActivityTone('DM', false, null, 'TENTATIVE'), 'dm-tentative')
  assert.equal(getActivityTone('DM', false, 'base', 'TENTATIVE'), 'dm-tentative')
})

test('a DM keeps its red color once someone owns the date', () => {
  assert.equal(getActivityTone('DM', false, null, 'SUPERVISOR'), 'dm')
  assert.equal(getActivityTone('DM', false, null, 'JOBSITE_SUPERINTENDENT'), 'dm')
  assert.equal(getActivityTone('DM'), 'dm')
})

test('only the DM turns orange; other stages and the Baseboard install keep their color', () => {
  assert.equal(getActivityTone('EXT', false, null, 'TENTATIVE'), 'ext')
  assert.equal(getActivityTone('EXT', true, null, 'TENTATIVE'), 'ext-order')
  assert.equal(getActivityTone('HW', false, null, 'TENTATIVE'), 'hw')
  assert.equal(getActivityTone('DM', false, 'baseboard-install', 'TENTATIVE'), 'baseboard')
})
