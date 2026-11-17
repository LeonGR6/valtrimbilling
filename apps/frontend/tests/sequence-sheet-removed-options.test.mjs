import assert from 'node:assert/strict'
import test from 'node:test'
import { addedOptionChanges, removedOptionChanges } from '../src/features/sequence-sheets/services/sequenceSheetRecord.js'

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

test('an unchecked option is a removal', () => {
  const changes = removedOptionChanges(
    phase(lot()),
    { lots: [{ id: 27, optionIds: [3] }] },
  )

  assert.deepEqual(changes, [
    { lotId: 27, optionId: 4 },
    { lotId: 27, optionId: 5 },
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

test('a phase that was not loaded has nothing to compare', () => {
  assert.deepEqual(removedOptionChanges(undefined, { lots: [{ id: 27, optionIds: [] }] }), [])
  assert.deepEqual(removedOptionChanges(phase(lot()), { lots: undefined }), [])
})

test('a checked option is an addition, in a Lot that existed or in a new one', () => {
  const previous = phase(lot({ optionIds: [3], optionPrices: undefined }))
  const saved = phase(
    lot({ optionIds: [3, 4, 5] }),
    // A Lot the edit created: its options are all new.
    lot({ id: 40, lotNumber: '40', optionIds: [3] }),
  )

  assert.deepEqual(addedOptionChanges(previous, saved), [
    { lotId: 27, optionId: 4 },
    { lotId: 27, optionId: 5 },
    { lotId: 40, optionId: 3 },
  ])
})

test('keeping or removing options adds nothing', () => {
  assert.deepEqual(addedOptionChanges(phase(lot()), phase(lot())), [])
  assert.deepEqual(addedOptionChanges(phase(lot()), phase(lot({ optionIds: [3] }))), [])
})

test('changing the Plan of a Lot adds the options of the new Plan', () => {
  const saved = phase(lot({ planId: 8, optionIds: [24, 25] }))

  assert.deepEqual(addedOptionChanges(phase(lot()), saved), [
    { lotId: 27, optionId: 24 },
    { lotId: 27, optionId: 25 },
  ])
})

test('Utility rows and an unknown previous Phase', () => {
  const utility = lot({ id: 30, isUtilityBuilding: true, optionIds: [] })
  assert.deepEqual(addedOptionChanges(phase(), phase(utility)), [])
  // Without a previous Phase every option of the saved one is new.
  assert.deepEqual(
    addedOptionChanges(undefined, phase(lot({ optionIds: [3] }))),
    [{ lotId: 27, optionId: 3 }],
  )
  assert.deepEqual(addedOptionChanges(phase(lot()), undefined), [])
})
