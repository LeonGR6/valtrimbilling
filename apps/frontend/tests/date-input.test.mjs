import test from 'node:test'
import assert from 'node:assert/strict'
import {
  completeDateText,
  dateTextToIso,
  isoToDateText,
  maskDateInput,
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
