import assert from 'node:assert/strict'
import test from 'node:test'

import { headingDivisions } from '../src/features/draw-invoice/utils/calendarHeadingDates.js'
import { formatLotRanges } from '../src/features/draw-invoice/utils/lotRanges.js'

test('lot numbers read as a short phrase', () => {
  assert.equal(formatLotRanges([]), '')
  assert.equal(formatLotRanges(['5']), 'Lot 5')
  assert.equal(formatLotRanges(['3', '4']), 'Lots 3, 4')
  assert.equal(formatLotRanges(['1', '2', '3', '4']), 'Lots 1–4')
  assert.equal(formatLotRanges(['1', '2', '3', '4', '7']), 'Lots 1–4, 7')
  assert.equal(formatLotRanges(['7', '1', '3', '2', '9', '8']), 'Lots 1–3, 7–9')
})

test('lot numbers that are not whole numbers are never put in a range', () => {
  assert.equal(formatLotRanges(['1A', '1B', '1C']), 'Lots 1A, 1B, 1C')
  assert.equal(formatLotRanges(['9', '10', '11']), 'Lots 9–11')
  assert.equal(formatLotRanges([12, 13, 14, 20]), 'Lots 12–14, 20')
})

test('an event with one date has no division lines', () => {
  assert.deepEqual(headingDivisions(null), [])
  assert.deepEqual(headingDivisions({ eventType: 'DM', eventDates: [] }), [])
  assert.deepEqual(headingDivisions({
    eventType: 'DM',
    eventDates: ['2026-10-01'],
    divisions: [{ date: '2026-10-01', lotIds: [1, 2], lotNumbers: ['1', '2'], variants: [] }],
  }), [])
})

test('an event with several dates lists each with its lots', () => {
  assert.deepEqual(headingDivisions({
    eventType: 'DM',
    eventDates: ['2026-10-01', '2026-10-08'],
    divisions: [
      { date: '2026-10-01', lotIds: [1, 2, 3, 4], lotNumbers: ['1', '2', '3', '4'], variants: ['DIVISION'] },
      { date: '2026-10-08', lotIds: [5], lotNumbers: ['5'], variants: ['DIVISION'] },
    ],
  }), [
    { key: '2026-10-01', date: 'Oct 1, 2026', lots: 'Lots 1–4', extra: '' },
    { key: '2026-10-08', date: 'Oct 8, 2026', lots: 'Lot 5', extra: '' },
  ])
})

test('an install-only or lock-up date is named, a normal one is not', () => {
  const lines = headingDivisions({
    eventType: 'HW',
    eventDates: ['2026-10-01', '2026-10-12', '2026-10-15'],
    divisions: [
      { date: '2026-10-01', lotIds: [1, 2], lotNumbers: ['1', '2'], variants: ['BASE'] },
      { date: '2026-10-12', lotIds: [1, 2], lotNumbers: ['1', '2'], variants: ['LOCK_UP'] },
      { date: '2026-10-15', lotIds: [1, 2], lotNumbers: ['1', '2'], variants: ['INSTALL_ONLY'] },
    ],
  })

  assert.deepEqual(lines.map(({ extra }) => extra), ['', 'lock-up', 'install only'])
})
