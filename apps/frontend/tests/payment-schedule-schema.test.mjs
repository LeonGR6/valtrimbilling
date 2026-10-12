import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validatePaymentScheduleMapping } from '../src/features/payment-schedules/schemas/paymentScheduleMappingSchema.js'

// Mirrors supabase/tests/phase_54 so the client and the database accept and
// reject the same mappings, with the same messages.

const cell = (overrides = {}) => ({
  phase: '003',
  lot: '0014',
  draw: 2,
  amount: 1446.78,
  page: 1,
  rect: { x: 0.1, y: 0.2, w: 0.05, h: 0.01 },
  ...overrides,
})
const mapping = (...cells) => ({ version: 1, layout: 'matrix', cells })

test('a valid set of cells is accepted, with or without a Phase', () => {
  const result = validatePaymentScheduleMapping(mapping(
    cell(),
    cell({ draw: 3, amount: 482.26 }),
    cell({ phase: null, lot: '1' }),
  ), 1)
  assert.deepEqual(result, { success: true, errors: [] })
})

test('the list layout is accepted too', () => {
  const result = validatePaymentScheduleMapping({ ...mapping(cell()), layout: 'line_items' }, 1)
  assert.equal(result.success, true)
})

test('only mapping version 1 with a known layout is accepted', () => {
  assert.equal(validatePaymentScheduleMapping({ ...mapping(cell()), version: 2 }, 1).success, false)
  assert.equal(validatePaymentScheduleMapping({ ...mapping(cell()), layout: 'grid' }, 1).success, false)
})

test('draws outside 1 to 5 are rejected', () => {
  for (const draw of [0, 6, 1.5]) {
    const result = validatePaymentScheduleMapping(mapping(cell({ draw })), 1)
    assert.deepEqual(result.errors, ['Each cell needs a draw number from 1 to 5'], String(draw))
  }
})

test('amounts need at most two decimals and cannot be negative', () => {
  for (const amount of [1.234, -1]) {
    const result = validatePaymentScheduleMapping(mapping(cell({ amount })), 1)
    assert.deepEqual(result.errors, ['Each cell needs an amount with at most two decimals'], String(amount))
  }
  assert.equal(validatePaymentScheduleMapping(mapping(cell({ amount: 0.1 + 0.2 })), 1).success, false)
  assert.equal(validatePaymentScheduleMapping(mapping(cell({ amount: 1929.04 })), 1).success, true)
})

test('pages beyond the document are rejected', () => {
  const result = validatePaymentScheduleMapping(mapping(cell({ page: 2 })), 1)
  assert.deepEqual(result.errors, ['The cell page is outside the document'])
})

test('rectangles that leave the page or are empty are rejected', () => {
  const outside = validatePaymentScheduleMapping(
    mapping(cell({ rect: { x: 0.9, y: 0.2, w: 0.3, h: 0.01 } })),
    1,
  )
  assert.deepEqual(outside.errors, ['The cell rectangle must stay inside the page'])
  const empty = validatePaymentScheduleMapping(
    mapping(cell({ rect: { x: 0.1, y: 0.2, w: 0, h: 0.01 } })),
    1,
  )
  assert.equal(empty.success, false)
})

test('the same Phase, Lot and draw twice is rejected, other Phases are fine', () => {
  const twice = validatePaymentScheduleMapping(mapping(cell(), cell({ amount: 2 })), 1)
  assert.deepEqual(twice.errors, ['Each Phase, Lot and draw can appear only once'])
  const nullTwice = validatePaymentScheduleMapping(
    mapping(cell({ phase: null }), cell({ phase: null })),
    1,
  )
  assert.equal(nullTwice.success, false)
  const otherPhase = validatePaymentScheduleMapping(mapping(cell(), cell({ phase: '004' })), 1)
  assert.equal(otherPhase.success, true)
})

test('lots and phases must be trimmed and at most 40 characters', () => {
  assert.deepEqual(
    validatePaymentScheduleMapping(mapping(cell({ lot: '' })), 1).errors,
    ['Each cell needs a Lot of 1 to 40 characters'],
  )
  assert.equal(validatePaymentScheduleMapping(mapping(cell({ lot: ' 1' })), 1).success, false)
  assert.deepEqual(
    validatePaymentScheduleMapping(mapping(cell({ phase: '' })), 1).errors,
    ['A cell Phase must be empty or 1 to 40 characters'],
  )
  assert.equal(validatePaymentScheduleMapping(mapping(cell({ lot: 'x'.repeat(41) })), 1).success, false)
})

test('unknown properties and an empty list are rejected', () => {
  assert.equal(validatePaymentScheduleMapping(mapping(cell({ script: 'x' })), 1).success, false)
  assert.deepEqual(
    validatePaymentScheduleMapping(mapping(), 1).errors,
    ['Map between 1 and 5000 cells'],
  )
})

const box = (draw = 1, overrides = {}) => ({
  draw, page: 1, rect: { x: 0.3, y: 0.5, w: 0.05, h: 0.01 }, ...overrides,
})
const withRows = (summaryRows, layout = 'matrix') => ({ ...mapping(cell()), layout, summaryRows })

test('summary rows are optional, per row, and only on a matrix', () => {
  assert.equal(validatePaymentScheduleMapping(mapping(cell()), 1).success, true)
  assert.equal(validatePaymentScheduleMapping(withRows({
    previouslyInvoiced: [box(1), box(2)], thisRequest: [box(1), box(2)],
  }), 1).success, true)
  assert.equal(validatePaymentScheduleMapping(withRows({ thisRequest: [box(3)] }), 1).success, true)
  assert.deepEqual(
    validatePaymentScheduleMapping(withRows({ thisRequest: [box(1)] }, 'line_items'), 1).errors,
    ['The summary rows only apply to the matrix layout'],
  )
})

test('summary boxes follow the same rules as cells', () => {
  const errors = (rows) => validatePaymentScheduleMapping(withRows(rows), 1).errors
  assert.deepEqual(errors({}), ['The summary rows need a previouslyInvoiced or a thisRequest list'])
  assert.deepEqual(errors({ thisRequest: [] }), ['Each summary row needs between 1 and 5 boxes, one per draw'])
  assert.deepEqual(errors({ thisRequest: [box(1), box(1)] }), ['Each summary box needs a draw number from 1 to 5, used once'])
  assert.deepEqual(errors({ thisRequest: [box(6)] }), ['Each summary box needs a draw number from 1 to 5, used once'])
  assert.deepEqual(errors({ thisRequest: [box(1, { page: 2 })] }), ['The summary box page is outside the document'])
  assert.deepEqual(
    errors({ thisRequest: [box(1, { rect: { x: 0.99, y: 0.5, w: 0.05, h: 0.01 } })] }),
    ['The summary box rectangle must stay inside the page'],
  )
  assert.equal(validatePaymentScheduleMapping(withRows({ other: [box(1)] }), 1).success, false)
})

test('every summary message exists in the migration, word for word', () => {
  const sql = readFileSync(
    new URL('../../backend/supabase/migrations/20261010180000_payment_schedule_summary_rows.sql', import.meta.url),
    'utf8',
  )
  for (const message of [
    'The summary rows only apply to the matrix layout',
    'The summary rows need a previouslyInvoiced or a thisRequest list',
    'Each summary row needs between 1 and 5 boxes, one per draw',
    'Each summary box needs a draw number from 1 to 5, used once',
    'The summary box page is outside the document',
    'The summary box rectangle must stay inside the page',
    'Each summary box needs a rectangle with x, y, w and h',
  ]) {
    assert.ok(sql.includes(message), message)
  }
})

test('every client message exists in the migration, word for word', () => {
  const sql = readFileSync(
    new URL('../../backend/supabase/migrations/20261010120000_payment_schedule_templates.sql', import.meta.url),
    'utf8',
  )
  const messages = [
    'Each cell needs a draw number from 1 to 5',
    'Each cell needs an amount with at most two decimals',
    'The cell page is outside the document',
    'The cell rectangle must stay inside the page',
    'Each Phase, Lot and draw can appear only once',
    'Each cell needs a Lot of 1 to 40 characters',
    'A cell Phase must be empty or 1 to 40 characters',
    'Map between 1 and 5000 cells',
  ]
  for (const message of messages) {
    assert.ok(sql.includes(message), message)
  }
})
