import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearShown,
  filterPickerOptions,
  isOptionMissingPrice,
  selectShown,
  shownPickerOptions,
  toggleOption,
} from '../src/features/sequence-sheets/utils/optionPicker.js'

const options = [
  { id: 1, code: '1STR1069', description: 'Pocket Door at Powder Bath' },
  { id: 2, code: '2FIN7001', description: 'Interior Door Upgrade to Masonite West End Collection (Includes rated door)' },
  { id: 3, code: '2FIN7003', description: 'Interior Door Upgrade to Masonite West End Collection (Not including rated door)' },
  { id: 4, code: '2WRD0000', description: 'Mirrored Walk-in Closet Wardrobe Door (Primary Bedroom)' },
  { id: 5, code: '2CAB3002', description: null },
]

test('the search matches code or description, every word, in any case', () => {
  assert.deepEqual(filterPickerOptions(options, '').map(({ id }) => id), [1, 2, 3, 4, 5])
  assert.deepEqual(filterPickerOptions(options, '  ').map(({ id }) => id), [1, 2, 3, 4, 5])
  assert.deepEqual(filterPickerOptions(options, '2fin').map(({ id }) => id), [2, 3])
  assert.deepEqual(filterPickerOptions(options, 'masonite not').map(({ id }) => id), [3])
  assert.deepEqual(filterPickerOptions(options, 'POCKET').map(({ id }) => id), [1])
  assert.deepEqual(filterPickerOptions(options, 'cab3002').map(({ id }) => id), [5])
  assert.deepEqual(filterPickerOptions(options, 'nothing like this'), [])
  assert.deepEqual(filterPickerOptions(options, undefined).length, 5)
})

test('"selected only" narrows the search result to what is picked', () => {
  assert.deepEqual(
    shownPickerOptions(options, { selectedOnly: true, selectedIds: [2, 4] }).map(({ id }) => id),
    [2, 4],
  )
  assert.deepEqual(
    shownPickerOptions(options, { query: 'door', selectedOnly: true, selectedIds: [1, 5] }).map(({ id }) => id),
    [1],
  )
  assert.equal(shownPickerOptions(options).length, 5)
})

test('select all and clear only touch the options that are shown', () => {
  const found = filterPickerOptions(options, 'fin')
  // 4 was picked earlier and is hidden by the search.
  assert.deepEqual(selectShown([4], found).sort(), [2, 3, 4])
  assert.deepEqual(clearShown([2, 3, 4], found), [4])
  assert.deepEqual(clearShown([2, 3, 4], options), [])
  assert.deepEqual(selectShown([2], [options[1]]), [2])
})

test('ticking an option adds it once, and unticking removes it', () => {
  assert.deepEqual(toggleOption([1], 2, true), [1, 2])
  assert.deepEqual(toggleOption([1, 2], 2, true), [1, 2])
  assert.deepEqual(toggleOption([1, 2], 1, false), [2])
  assert.deepEqual(toggleOption([], 3, false), [])
})

test('an Option with no price cannot be added, but a priced or NA one can', () => {
  const priced = [
    { id: 1, code: 'A', price: 100 },
    { id: 2, code: 'B', price: null },
    { id: 3, code: 'C', price: 0, priceNotApplicable: true },
    { id: 4, code: 'D', price: -50 },
  ]

  assert.deepEqual(priced.map(isOptionMissingPrice), [false, true, false, false])
  assert.equal(isOptionMissingPrice({ id: 5, code: 'E' }), false)
  assert.deepEqual(selectShown([], priced).sort(), [1, 3, 4])
  // One already on the Lot stays, so it can still be unticked.
  assert.deepEqual(selectShown([2], priced).sort(), [1, 2, 3, 4])
})
