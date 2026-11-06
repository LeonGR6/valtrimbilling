import assert from 'node:assert/strict'
import test from 'node:test'
import { filterPlansByQuery } from '../src/features/jobs/utils/planSearch.js'

const option = (id, code, description) => ({ id, code, description })
const plans = [
  {
    id: 1,
    code: '2A',
    name: 'Alder',
    options: [option(11, 'BB110', 'Upgraded counters'), option(12, 'BB414', 'Extra outlet'), option(13, '2FIN7001', 'Pantry shelves')],
  },
  {
    id: 2,
    code: '3B',
    name: 'Birch',
    options: [option(21, 'BB110', 'Upgraded counters'), option(22, 'BD355', 'Garage door')],
  },
  { id: 3, code: '4C', name: '', options: [] },
]

const codes = (list) => list.map(({ code }) => code)

test('an empty search lists every Plan as it is', () => {
  assert.equal(filterPlansByQuery(plans, ''), plans)
  assert.equal(filterPlansByQuery(plans, '   '), plans)
  assert.equal(filterPlansByQuery(plans, undefined), plans)
})

test('a Plan that matches by code or name keeps all of its Options', () => {
  const byCode = filterPlansByQuery(plans, '2a')
  assert.deepEqual(codes(byCode), ['2A'])
  assert.equal(byCode[0], plans[0])

  const byName = filterPlansByQuery(plans, 'BIRCH')
  assert.deepEqual(codes(byName), ['3B'])
  assert.equal(byName[0].options.length, 2)
})

test('a Plan with some Options that match lists only those, and remembers what it had', () => {
  const result = filterPlansByQuery(plans, 'outlet')

  assert.deepEqual(codes(result), ['2A'])
  assert.deepEqual(codes(result[0].options), ['BB414'])
  assert.equal(result[0].optionCount, 3)
  assert.deepEqual(codes(result[0].allOptions), ['BB110', 'BB414', '2FIN7001'])
  // The Plan in the list is not changed.
  assert.equal(plans[0].options.length, 3)
})

test('an Option is found by its code or by its description, in several Plans', () => {
  const byCode = filterPlansByQuery(plans, 'bb110')
  assert.deepEqual(codes(byCode), ['2A', '3B'])
  assert.deepEqual(byCode.map((plan) => plan.options.length), [1, 1])

  assert.deepEqual(codes(filterPlansByQuery(plans, 'garage')[0].options), ['BD355'])
})

test('a search with no match lists nothing, and a Plan without Options is found by its code', () => {
  assert.deepEqual(filterPlansByQuery(plans, 'zzz'), [])
  assert.deepEqual(codes(filterPlansByQuery(plans, '4c')), ['4C'])
})
