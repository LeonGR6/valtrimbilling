import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultTestValue,
  formatReleaseValue,
  printedReleaseValues,
  todayDateInput,
} from '../src/features/release-templates/services/releaseValueFormat.js'

test('dates print in each format from a date input value or a Date', () => {
  assert.equal(formatReleaseValue('through_date', 'MM/DD/YYYY', '2026-09-30'), '09/30/2026')
  assert.equal(formatReleaseValue('through_date', 'MMMM D, YYYY', '2026-09-03'), 'September 3, 2026')
  assert.equal(formatReleaseValue('signature_date', 'YYYY-MM-DD', '2026-01-05'), '2026-01-05')
  assert.equal(formatReleaseValue('waiver_release_dates', 'MM/DD/YYYY', new Date(2026, 0, 9)), '01/09/2026')
})

test('a date that does not exist or is not a date prints nothing', () => {
  assert.equal(formatReleaseValue('through_date', 'MM/DD/YYYY', '2026-02-30'), '')
  assert.equal(formatReleaseValue('through_date', 'MM/DD/YYYY', '09/30/2026'), '')
  assert.equal(formatReleaseValue('through_date', 'MM/DD/YYYY', ''), '')
  assert.equal(formatReleaseValue('through_date', 'MM/DD/YYYY', undefined), '')
  assert.equal(formatReleaseValue('through_date', 'MM/DD/YYYY', new Date('nope')), '')
})

test('amounts print as currency or plain with two decimals', () => {
  assert.equal(formatReleaseValue('check_amount', 'currency', 1250), '$1,250.00')
  assert.equal(formatReleaseValue('check_amount', 'currency', '1250.5'), '$1,250.50')
  assert.equal(formatReleaseValue('check_amount', 'currency', '$1,234,567.891'), '$1,234,567.89')
  assert.equal(formatReleaseValue('check_amount', 'plain', '1,250'), '1,250.00')
  assert.equal(formatReleaseValue('check_amount', 'plain', 1234567.5), '1,234,567.50')
  assert.equal(formatReleaseValue('check_amount', 'plain', 12.5), '12.50')
  assert.equal(formatReleaseValue('unpaid_progress_amount', 'currency', '0'), '$0.00')
  assert.equal(formatReleaseValue('unpaid_progress_amount', 'currency', -12.3), '-$12.30')
})

test('an amount that is not a number prints nothing', () => {
  for (const value of ['', 'abc', '12abc', null, undefined, Number.NaN, '1.2.3']) {
    assert.equal(formatReleaseValue('check_amount', 'currency', value), '', String(value))
  }
})

test('an unknown variable prints nothing', () => {
  assert.equal(formatReleaseValue('invoice_number', 'plain', '10'), '')
})

test('a test fill starts with today and a sample amount', () => {
  const day = new Date(2026, 8, 5)
  assert.equal(todayDateInput(day), '2026-09-05')
  assert.equal(defaultTestValue('through_date', day), '2026-09-05')
  assert.equal(defaultTestValue('signature_date', day), '2026-09-05')
  assert.equal(defaultTestValue('check_amount', day), '1250.00')
  assert.equal(defaultTestValue('unpaid_progress_amount', day), '1250.00')
})

test('the Exceptions blanks print N/A when there is nothing to list', () => {
  for (const empty of [[], undefined, null, '', ['nope']]) {
    assert.equal(printedReleaseValues('waiver_release_dates', 'MM/DD/YYYY', empty), 'N/A')
    assert.equal(printedReleaseValues('unpaid_progress_amount', 'plain', empty), 'N/A')
    assert.equal(printedReleaseValues('disputed_claims_amount', 'currency', empty), 'N/A')
  }
})

test('the Exceptions blanks print their values when there are any', () => {
  assert.equal(printedReleaseValues('waiver_release_dates', 'MM/DD/YYYY', ['2026-09-20', '2026-10-05']), '09/20/2026, 10/05/2026')
  assert.equal(printedReleaseValues('unpaid_progress_amount', 'plain', [1200, '845.5']), '1,200.00, 845.50')
  assert.equal(printedReleaseValues('disputed_claims_amount', 'currency', 2045.5), '$2,045.50')
  assert.equal(printedReleaseValues('disputed_claims_amount', 'plain', 0), '0.00')
})

test('the other variables and unknown ones stay blank when empty', () => {
  assert.equal(printedReleaseValues('through_date', 'MM/DD/YYYY', ''), '')
  assert.equal(printedReleaseValues('check_amount', 'plain', undefined), '')
  assert.equal(printedReleaseValues('invoice_number', 'plain', ''), '')
})
