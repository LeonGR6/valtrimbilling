import test from 'node:test'
import assert from 'node:assert/strict'
import {
  completeDateText,
  dateTextToIso,
  isoToDateText,
  maskDateInput,
  monthGrid,
  monthOf,
  monthTitle,
  shiftMonth,
  todayIso,
} from '../src/utils/dateInput.js'

test('typed dates become ISO dates in the common ways of writing them', () => {
  for (const text of ['05/12/2026', '5/12/2026', '5-12-2026', '5.12.2026', '05122026', ' 5/12/2026 ']) {
    assert.equal(dateTextToIso(text), '2026-05-12', text)
  }
})

test('incomplete or impossible dates are not dates', () => {
  for (const text of ['', '05/12', '05/12/26', '13/01/2026', '02/30/2026', '00/10/2026', 'abc', '05/12/20266']) {
    assert.equal(dateTextToIso(text), '', text)
  }
  assert.equal(dateTextToIso('02/29/2028'), '2028-02-29')
  assert.equal(dateTextToIso('02/29/2027'), '')
})

test('digits get their slashes as they are typed and Backspace is never blocked', () => {
  assert.equal(maskDateInput('0'), '0')
  assert.equal(maskDateInput('05'), '05')
  assert.equal(maskDateInput('051'), '05/1')
  assert.equal(maskDateInput('0512'), '05/12')
  assert.equal(maskDateInput('05122'), '05/12/2')
  assert.equal(maskDateInput('05122026999'), '05/12/2026')
  // Deleting the last digit leaves no trailing slash behind.
  assert.equal(maskDateInput('05/1'.slice(0, 2)), '05')
  // Typed separators are respected, other characters are dropped.
  assert.equal(maskDateInput('5/1'), '5/1')
  assert.equal(maskDateInput('5-1-2026'), '5/1/2026')
  assert.equal(maskDateInput('5//1x'), '5/1')
  assert.equal(maskDateInput('5/'), '5/')
  assert.equal(maskDateInput('12/'), '12/')
  // The slash after the day goes in by itself even when the first one was typed.
  assert.equal(maskDateInput('12/052024'), '12/05/2024')
  assert.equal(maskDateInput('12/05/2024'), '12/05/2024')
  assert.equal(maskDateInput('12/05/2024/'), '12/05/2024')
  assert.equal(maskDateInput('5/12/2026'), '5/12/2026')
})

test('a finished entry is padded and a two-digit year is read as 20YY', () => {
  assert.equal(completeDateText('5/2/2026'), '05/02/2026')
  assert.equal(completeDateText('5/2/26'), '05/02/2026')
  assert.equal(completeDateText('05/02'), '05/02')
  assert.equal(completeDateText(''), '')
})

test('ISO dates are shown as MM/DD/YYYY', () => {
  assert.equal(isoToDateText('2026-05-12'), '05/12/2026')
  assert.equal(isoToDateText('2026-05-12T00:00:00'), '05/12/2026')
  assert.equal(isoToDateText(''), '')
  assert.equal(isoToDateText(undefined), '')
})

test('the month a calendar shows comes from the date, else from today', () => {
  const now = new Date(2026, 9, 22)
  assert.deepEqual(monthOf('2026-03-05', now), { year: 2026, month: 2 })
  assert.deepEqual(monthOf('', now), { year: 2026, month: 9 })
  assert.deepEqual(monthOf('not a date', now), { year: 2026, month: 9 })
  assert.equal(todayIso(now), '2026-10-22')
  assert.equal(todayIso(new Date(2026, 0, 5)), '2026-01-05')
})

test('months roll over the year in both directions', () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 })
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 })
  assert.deepEqual(shiftMonth({ year: 2026, month: 5 }, 0), { year: 2026, month: 5 })
  assert.deepEqual(shiftMonth({ year: 2026, month: 5 }, -18), { year: 2024, month: 11 })
  assert.equal(monthTitle({ year: 2026, month: 9 }), 'October 2026')
})

test('a month is drawn as six Sunday-first weeks with the neighbouring days around it', () => {
  const weeks = monthGrid({ year: 2026, month: 9 })

  assert.equal(weeks.length, 6)
  assert.ok(weeks.every((week) => week.length === 7))
  // October 1, 2026 is a Thursday: the first row starts on Sunday, September 27.
  assert.equal(weeks[0][0].iso, '2026-09-27')
  assert.equal(weeks[0][0].inMonth, false)
  assert.equal(weeks[0][4].iso, '2026-10-01')
  assert.equal(weeks[0][4].inMonth, true)
  assert.equal(weeks.flat().filter((day) => day.inMonth).length, 31)
  assert.equal(weeks[5][6].iso, '2026-11-07')

  // A month that starts on a Sunday has no days before it; February of a leap year has 29.
  assert.equal(monthGrid({ year: 2026, month: 1 })[0][0].iso, '2026-02-01')
  assert.equal(monthGrid({ year: 2028, month: 1 }).flat().filter((day) => day.inMonth).length, 29)
})
