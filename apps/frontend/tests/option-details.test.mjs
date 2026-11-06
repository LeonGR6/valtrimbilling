import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countOptionUnits,
  describeOptionDetail,
  detailOf,
  optionDetailsFromRows,
  optionDetailsPayload,
  pruneOptionDetails,
  setOptionLocations,
  setOptionQuantity,
} from '../src/features/sequence-sheets/utils/optionDetails.js'
import { getSelectedOptionCount } from '../src/features/sequence-sheets/utils/phaseCounts.js'
import { createPhaseByLotSchema } from '../src/features/sequence-sheets/schemas/phaseByLotSchema.js'

test('an Option with no details is one unit with no location', () => {
  assert.deepEqual(detailOf({}, 41), { quantity: 1, locations: [] })
  assert.deepEqual(detailOf(undefined, 41), { quantity: 1, locations: [] })
  assert.equal(describeOptionDetail(detailOf({}, 41)), null)
})

test('the quantity is kept between 1 and 99 and never below the locations named', () => {
  assert.equal(detailOf({ 41: { quantity: 0 } }, 41).quantity, 1)
  assert.equal(detailOf({ 41: { quantity: 500 } }, 41).quantity, 99)
  assert.equal(detailOf({ 41: { quantity: 'x' } }, 41).quantity, 1)
  assert.equal(detailOf({ 41: { quantity: 1, locations: ['A', 'B'] } }, 41).quantity, 2)
})

test('raising the quantity keeps the details only when they differ from one unit', () => {
  const three = setOptionQuantity({}, 41, 3)
  assert.deepEqual(three, { 41: { quantity: 3, locations: [] } })
  assert.deepEqual(setOptionQuantity(three, 41, 1), {})
})

test('lowering the quantity drops the locations beyond it', () => {
  const details = setOptionLocations({}, 41, ['1st floor', '2nd floor', '3rd floor'])
  assert.deepEqual(details[41].locations.length, 3)
  assert.deepEqual(setOptionQuantity(details, 41, 2), {
    41: { quantity: 2, locations: ['1st floor', '2nd floor'] },
  })
})

test('the quantity follows the locations: taking one out lowers it', () => {
  const five = setOptionLocations({}, 41, ['A', 'B', 'C', 'D', 'E'])
  assert.equal(detailOf(five, 41).quantity, 5)

  const three = setOptionLocations(five, 41, ['A', 'B', 'C'])
  assert.deepEqual(detailOf(three, 41), { quantity: 3, locations: ['A', 'B', 'C'] })

  // Taking out the last one goes back to a single unit, which is the default (no entry).
  assert.deepEqual(setOptionLocations(setOptionLocations({}, 41, ['A']), 41, []), {})
  assert.deepEqual(detailOf(setOptionLocations(three, 41, []), 41), { quantity: 1, locations: [] })

  // The stepper can still go above the places named.
  const spare = setOptionQuantity(three, 41, 4)
  assert.deepEqual(detailOf(spare, 41), { quantity: 4, locations: ['A', 'B', 'C'] })
})

test('naming locations sets the quantity to the places and trims the text', () => {
  const details = setOptionLocations({}, 41, [' 1st floor ', '', '2nd floor'])
  assert.deepEqual(details, { 41: { quantity: 2, locations: ['1st floor', '2nd floor'] } })
  assert.equal(describeOptionDetail(detailOf(details, 41)), '×2 · 1st floor, 2nd floor')
  assert.equal(describeOptionDetail({ quantity: 1, locations: ['Garage'] }), 'Garage')
  assert.equal(describeOptionDetail({ quantity: 4, locations: [] }), '×4')
})

test('an Option taken out of the Lot loses its details', () => {
  const details = { 41: { quantity: 2, locations: [] }, 42: { quantity: 3, locations: [] } }
  assert.deepEqual(pruneOptionDetails(details, [42]), { 42: { quantity: 3, locations: [] } })
})

test('a Phase counts every unit of its Options', () => {
  const lot = { optionIds: [41, 42], optionDetails: { 41: { quantity: 3, locations: [] } } }
  assert.equal(countOptionUnits(lot), 4)
  assert.equal(getSelectedOptionCount({ lots: [lot, { optionIds: [43] }] }), 5)
  assert.equal(getSelectedOptionCount({ lots: [{ optionIds: [] }] }), 0)
})

test('the database receives only the selected Options with a quantity above one or a place', () => {
  assert.deepEqual(
    optionDetailsPayload({
      optionIds: [41, 42, 43],
      optionDetails: {
        41: { quantity: 2, locations: [] },
        42: { quantity: 1, locations: [] },
        99: { quantity: 4, locations: ['Attic'] },
      },
    }),
    [{ option_id: 41, quantity: 2, locations: [] }],
  )
  assert.deepEqual(optionDetailsFromRows(undefined), {})
})

function schemaFor(options) {
  return createPhaseByLotSchema({
    sequenceSheet: { phases: [], plans: [{ id: 31, code: 'A', options }] },
  }, undefined, false)
}

const planOptions = [{ id: 41 }, { id: 42 }]

function parse(lot) {
  return schemaFor(planOptions).safeParse({
    phaseName: '1',
    building: '',
    lots: [{ lotNumber: '1', planId: 31, reverse: false, isUtilityBuilding: false, optionIds: [41], ...lot }],
  })
}

test('the form accepts a quantity and locations on a selected Option', () => {
  const result = parse({ optionDetails: { 41: { quantity: 3, locations: ['1st floor', '2nd floor'] } } })
  assert.equal(result.success, true)
  assert.deepEqual(result.data.lots[0].optionDetails, { 41: { quantity: 3, locations: ['1st floor', '2nd floor'] } })
})

test('the form refuses details that cannot be saved', () => {
  const message = (lot) => parse(lot).error?.issues.map((issue) => issue.message).join(' | ')

  assert.match(message({ optionDetails: { 41: { quantity: 0, locations: [] } } }), /at least 1/)
  assert.match(message({ optionDetails: { 41: { quantity: 100, locations: [] } } }), /at most 99/)
  assert.match(message({ optionDetails: { 41: { quantity: 1, locations: ['A', 'B'] } } }), /more locations than its quantity/)
  assert.match(message({ optionDetails: { 42: { quantity: 2, locations: [] } } }), /not selected/)
  assert.match(message({ optionDetails: { 41: { quantity: 2, locations: ['x'.repeat(101)] } } }), /100 characters/)
})
