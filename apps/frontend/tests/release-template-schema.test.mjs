import assert from 'node:assert/strict'
import test from 'node:test'
import { validateReleaseMapping } from '../src/features/release-templates/schemas/releaseMappingSchema.js'

// Mirrors supabase/tests/phase_44 and phase_45 so the client and the database
// accept and reject the same mappings, with the same messages.

const rect = (overrides = {}) => ({
  kind: 'rect', page: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.03, ...overrides,
})
const field = (overrides = {}) => ({
  variable: 'through_date', target: rect(), fontSize: 10, format: 'MM/DD/YYYY', ...overrides,
})
const mapping = (...fields) => ({ version: 1, fields })

test('a valid rectangle mapping is accepted', () => {
  const result = validateReleaseMapping(mapping(
    field(),
    field({
      variable: 'check_amount',
      target: rect({ page: 2, x: 0.6, y: 0.3 }),
      fontSize: 10.5,
      format: 'currency',
      cover: true,
    }),
  ), 2)
  assert.deepEqual(result, { success: true, errors: [] })
})

test('a form field mapping is accepted', () => {
  const result = validateReleaseMapping(mapping(field({
    variable: 'check_amount',
    target: { kind: 'acroform', fieldName: 'Amount of Check' },
    format: 'plain',
  })), 1)
  assert.equal(result.success, true)
})

test('a signature date accepts date formats only', () => {
  const ok = validateReleaseMapping(mapping(field({ variable: 'signature_date', format: 'MMMM D, YYYY' })), 1)
  assert.equal(ok.success, true)
  const bad = validateReleaseMapping(mapping(field({ variable: 'signature_date', format: 'currency' })), 1)
  assert.deepEqual(bad.errors, ['Select a supported format for signature_date'])
})

test('variables outside the catalog are rejected', () => {
  const result = validateReleaseMapping(mapping(field({ variable: 'invoice_number', format: 'plain' })), 1)
  assert.deepEqual(result.errors, ['Select a supported Release variable'])
})

test('rectangles that leave the page are rejected', () => {
  const result = validateReleaseMapping(mapping(field({ target: rect({ x: 0.9, w: 0.3 }) })), 1)
  assert.deepEqual(result.errors, ['The rectangle must stay inside the page'])
})

test('empty rectangles are rejected', () => {
  const result = validateReleaseMapping(mapping(field({ target: rect({ w: 0 }) })), 1)
  assert.equal(result.success, false)
})

test('pages beyond the document are rejected', () => {
  const result = validateReleaseMapping(mapping(field({ target: rect({ page: 3 }) })), 2)
  assert.deepEqual(result.errors, ['The rectangle page is outside the document'])
  assert.equal(validateReleaseMapping(mapping(field({ target: rect({ page: 1.5 }) })), 2).success, false)
})

test('a format must belong to its variable', () => {
  const result = validateReleaseMapping(mapping(field({ variable: 'check_amount', format: 'MM/DD/YYYY' })), 1)
  assert.deepEqual(result.errors, ['Select a supported format for check_amount'])
  const through = validateReleaseMapping(mapping(field({ format: 'plain' })), 1)
  assert.deepEqual(through.errors, ['Select a supported format for through_date'])
})

test('unreadable font sizes are rejected', () => {
  const small = validateReleaseMapping(mapping(field({ fontSize: 2 })), 1)
  assert.deepEqual(small.errors, ['Enter a font size between 4 and 48'])
  assert.equal(validateReleaseMapping(mapping(field({ fontSize: 49 })), 1).success, false)
  assert.equal(validateReleaseMapping(mapping(field({ fontSize: Number.NaN })), 1).success, false)
})

test('unknown properties are rejected so the JSON is not free-form', () => {
  assert.equal(validateReleaseMapping(mapping(field({ script: 'x' })), 1).success, false)
  assert.equal(validateReleaseMapping(mapping(field({ target: rect({ extra: 1 }) })), 1).success, false)
  assert.equal(validateReleaseMapping({ ...mapping(field()), extra: true }, 1).success, false)
})

test('an empty or oversized mapping is rejected', () => {
  assert.deepEqual(validateReleaseMapping(mapping(), 1).errors, ['Map between 1 and 12 fields'])
  const thirteen = Array.from({ length: 13 }, () => field())
  assert.deepEqual(validateReleaseMapping(mapping(...thirteen), 1).errors, ['Map between 1 and 12 fields'])
})

test('only mapping version 1 is accepted', () => {
  assert.equal(validateReleaseMapping({ version: 2, fields: [field()] }, 1).success, false)
  assert.equal(validateReleaseMapping(null, 1).success, false)
})

test('a target must be a rectangle or a form field', () => {
  const result = validateReleaseMapping(mapping(field({ target: { kind: 'circle' } })), 1)
  assert.equal(result.success, false)
  assert.equal(validateReleaseMapping(mapping(field({ target: { kind: 'acroform', fieldName: ' padded ' } })), 1).success, false)
})

test('the exception blanks take dates and amounts respectively', () => {
  const dates = (format) => mapping(field({ variable: 'waiver_release_dates', format }))
  const unpaid = (format) => mapping(field({ variable: 'unpaid_progress_amount', format }))

  assert.equal(validateReleaseMapping(dates('MMMM D, YYYY'), 1).success, true)
  assert.deepEqual(
    validateReleaseMapping(dates('currency'), 1).errors,
    ['Select a supported format for waiver_release_dates'],
  )
  assert.equal(validateReleaseMapping(unpaid('plain'), 1).success, true)
  assert.deepEqual(
    validateReleaseMapping(unpaid('MM/DD/YYYY'), 1).errors,
    ['Select a supported format for unpaid_progress_amount'],
  )
})
