import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addLotRanges,
  lotNumbersOfRanges,
  parseLotToken,
  removeLotRange,
  splitTypedLots,
} from '../src/features/sequence-sheets/utils/lotRange.js'

const lots = (value, options) => lotNumbersOfRanges(addLotRanges([], value, options).ranges)

test('a range goes up from its first lot to its last', () => {
  assert.deepEqual(lots('1-5'), ['1', '2', '3', '4', '5'])
  assert.deepEqual(lots('9-9'), ['9'])
})

test('a range can go down: the lots come in the order they were typed', () => {
  assert.deepEqual(lots('5-1'), ['5', '4', '3', '2', '1'])
  assert.deepEqual(lots('14-10'), ['14', '13', '12', '11', '10'])
})

test('a range with spaces or another kind of dash is the same range', () => {
  assert.deepEqual(lots('1 - 3'), ['1', '2', '3'])
  assert.deepEqual(lots('3–1'), ['3', '2', '1'])
  assert.deepEqual(lots('5 —3'), ['5', '4', '3'])
})

test('a lot with a decimal, or with letters, is one lot', () => {
  assert.deepEqual(lots('12'), ['12'])
  assert.deepEqual(lots('12.1'), ['12.1'])
  assert.deepEqual(lots('12a'), ['12A'])
  // The text of a single lot is kept: 06 is not 6.
  assert.deepEqual(lots('06'), ['06'])
})

test('lots and ranges separated by spaces, commas or semicolons become one chip each', () => {
  const { ranges, error } = addLotRanges([], '12, 12.1 13;15-17 15.1')

  assert.equal(error, '')
  assert.deepEqual(ranges.map(({ token }) => token), ['12', '12.1', '13', '15-17', '15.1'])
  assert.deepEqual(lotNumbersOfRanges(ranges), ['12', '12.1', '13', '15', '16', '17', '15.1'])
})

test('a chip is added after the ones already there, and a repeated chip is not added twice', () => {
  const first = addLotRanges([], '1-3')
  const second = addLotRanges(first.ranges, ['1-3', '7'])

  assert.equal(second.error, '')
  assert.deepEqual(second.ranges.map(({ token }) => token), ['1-3', '7'])
  assert.deepEqual(removeLotRange(second.ranges, '1-3').map(({ token }) => token), ['7'])
})

test('what is not a lot or a range is reported and not added', () => {
  for (const text of ['abc-def', 'nope', '1-', '-5', '1.5-3', '12.', '1..2', '1-2-3', '#12']) {
    const result = addLotRanges([], text)
    assert.deepEqual(result.ranges, [], text)
    assert.match(result.error, /is not a lot or a range/, text)
  }

  assert.equal(addLotRanges([], '0').error, 'Lot numbers must be greater than zero.')
  assert.equal(addLotRanges([], '0-3').error, 'Lot numbers must be greater than zero.')
  assert.match(addLotRanges([], `1${'A'.repeat(30)}`).error, /up to 30 characters/)
})

test('one bad chip does not stop the good ones that come with it', () => {
  const { ranges, error } = addLotRanges([], '1-3 nope 7')

  assert.deepEqual(ranges.map(({ token }) => token), ['1-3', '7'])
  assert.match(error, /"nope" is not a lot or a range/)
})

test('a lot cannot be in two chips or already be in the phase', () => {
  const chips = addLotRanges([], '1-5').ranges

  const repeated = addLotRanges(chips, '5-7')
  assert.deepEqual(repeated.ranges, chips)
  assert.equal(repeated.error, 'Lot 5 is already in 1-5.')

  const taken = addLotRanges([], '10-12', { existing: new Set(['11']) })
  assert.deepEqual(taken.ranges, [])
  assert.equal(taken.error, 'Lot 11 has already been added.')

  // 12 and 12.1 are different Lots.
  assert.equal(addLotRanges([], '12.1', { existing: new Set(['12']) }).error, '')
})

test('the lots of all the chips fit in what the phase has room for', () => {
  const full = addLotRanges([], '1-5', { capacity: 4 })
  assert.deepEqual(full.ranges, [])
  assert.equal(full.error, 'The phase has room for 4 more lots.')

  const none = addLotRanges([], '1', { capacity: 0 })
  assert.equal(none.error, 'A phase can contain up to 500 lots.')

  const second = addLotRanges(addLotRanges([], '1-3', { capacity: 5 }).ranges, '4-6', { capacity: 5 })
  assert.deepEqual(second.ranges.map(({ token }) => token), ['1-3'])
  assert.equal(second.error, 'The phase has room for 5 more lots.')

  assert.match(parseLotToken('1-501').error, /up to 500 lots/)
})

test('a range that has no end yet stays in the box while it is typed', () => {
  assert.deepEqual(splitTypedLots('1-'), { done: '', rest: '1-' })
  assert.deepEqual(splitTypedLots('1- '), { done: '', rest: '1-' })
  assert.deepEqual(splitTypedLots('1- 5'), { done: '', rest: '1-5' })
  assert.deepEqual(splitTypedLots('1-5 '), { done: '1-5 ', rest: '' })
  assert.deepEqual(splitTypedLots('1-5,'), { done: '1-5,', rest: '' })
  assert.deepEqual(splitTypedLots('1-5 7'), { done: '1-5 ', rest: '7' })
  assert.deepEqual(splitTypedLots('12.'), { done: '', rest: '12.' })
  assert.deepEqual(splitTypedLots('  '), { done: '', rest: '' })
})
