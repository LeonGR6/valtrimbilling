import assert from 'node:assert/strict'
import test from 'node:test'
import { removedOptionChanges } from '../src/features/sequence-sheets/services/sequenceSheetRecord.js'

const lot = (overrides) => ({
  id: 27,
  lotNumber: '27',
  planId: 12,
  reverse: false,
  optionIds: [3, 4, 5],
  isUtilityBuilding: false,
  optionPrices: {
    3: { id: 200, price: 1126, priceNotApplicable: false },
    4: { id: 201, price: 81, priceNotApplicable: false },
    5: { id: 202, price: 0, priceNotApplicable: true },
  },
  ...overrides,
})

const phase = (...lots) => ({ id: 5, name: 'MODELS', building: '', lots })

test('an unchecked option is a removal, with the price the Lot was billing', () => {
  const changes = removedOptionChanges(
    phase(lot()),
    { lots: [{ id: 27, optionIds: [3] }] },
  )

  assert.deepEqual(changes, [
    { lotId: 27, optionId: 4, price: 81, priceNotApplicable: false },
    { lotId: 27, optionId: 5, price: 0, priceNotApplicable: true },
  ])
})

test('keeping every option, or adding one, removes nothing', () => {
  assert.deepEqual(removedOptionChanges(phase(lot()), { lots: [{ id: 27, optionIds: [3, 4, 5] }] }), [])
  assert.deepEqual(removedOptionChanges(phase(lot()), { lots: [{ id: 27, optionIds: [3, 4, 5, 9] }] }), [])
  // Ids may arrive as text from a form.
  assert.deepEqual(removedOptionChanges(phase(lot()), { lots: [{ id: '27', optionIds: ['3', '4', '5'] }] }), [])
})

test('changing the Plan of a Lot drops the options of the old Plan', () => {
  const changes = removedOptionChanges(
    phase(lot()),
    { lots: [{ id: 27, planId: 8, optionIds: [24] }] },
  )

  assert.deepEqual(changes.map(({ optionId }) => optionId), [3, 4, 5])
})

test('new rows, deleted Lots and Utility rows are not removed options', () => {
  const previous = phase(lot(), lot({ id: 28, optionIds: [3] }))
  const changes = removedOptionChanges(previous, {
    lots: [
      // Lot 28 is gone from the form (deleted): not listed.
      { id: 27, optionIds: [3, 4, 5] },
      // A new row has no previous options.
      { id: null, optionIds: [3] },
      // A Utility row carries no options.
      { id: 30, isUtilityBuilding: true, optionIds: [] },
    ],
  })

  assert.deepEqual(changes, [])
})

test('a removed option without a pinned price carries none', () => {
  const changes = removedOptionChanges(
    phase(lot({ optionIds: [3], optionPrices: undefined })),
    { lots: [{ id: 27, optionIds: [] }] },
  )

  assert.deepEqual(changes, [{ lotId: 27, optionId: 3 }])
})

test('a phase that was not loaded has nothing to compare', () => {
  assert.deepEqual(removedOptionChanges(undefined, { lots: [{ id: 27, optionIds: [] }] }), [])
  assert.deepEqual(removedOptionChanges(phase(lot()), { lots: undefined }), [])
})
