import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addPlaceLine,
  buildChangeOrderLines,
  buildPlaceLines,
  clearLineOverrides,
  dropAmountsEqualToDefault,
  parseAmount,
  removePlaceLine,
  sanitizePriceInput,
  setLineOverride,
  summarizeChangeOrderLines,
  updatePlaceLine,
} from '../src/features/change-orders/utils/pricing.js'

const rows = [
  { lotId: 1, lot: '1' },
  { lotId: 2, lot: '2' },
  { lotId: 3, lot: '3' },
]

test('the amount field keeps digits and two decimals', () => {
  assert.equal(sanitizePriceInput('$1,250.559'), '1250.55')
  assert.equal(sanitizePriceInput('12.3.4'), '12.34')
  assert.equal(sanitizePriceInput('abc'), '')
  assert.equal(sanitizePriceInput('75.'), '75.')
})

test('a credit starts with a minus sign, which only counts at the start', () => {
  assert.equal(sanitizePriceInput('-250.5'), '-250.5')
  assert.equal(sanitizePriceInput('-'), '-')
  assert.equal(sanitizePriceInput('12-3'), '123')
  assert.equal(sanitizePriceInput('--5'), '-5')
  assert.equal(parseAmount('-'), null)
  assert.equal(parseAmount('-250.5'), -250.5)
})

test('credits lower the total and are the lowest amount', () => {
  const lines = buildChangeOrderLines(rows, { defaultAmount: '100', lineOverrides: { 2: { amount: '-30.25' } } })
  const summary = summarizeChangeOrderLines(lines)

  assert.equal(summary.total, 169.75)
  assert.equal(summary.min, -30.25)
  assert.equal(summary.max, 100)
})

test('an empty or partial amount is not a number', () => {
  assert.equal(parseAmount(''), null)
  assert.equal(parseAmount('.'), null)
  assert.equal(parseAmount('75.'), 75)
})

test('every lot takes the default scope and amount', () => {
  const lines = buildChangeOrderLines(rows, { defaultScope: 'Add attic ladder', defaultAmount: '10' })

  assert.deepEqual(lines.map((line) => line.amount), [10, 10, 10])
  assert.deepEqual(lines.map((line) => line.scope), ['Add attic ladder', 'Add attic ladder', 'Add attic ladder'])
  assert.ok(lines.every((line) => !line.ownAmount && !line.ownScope))
})

test('a lot with its own values keeps them when the default changes', () => {
  const lineOverrides = setLineOverride({}, [2], 'amount', '25.50')
  const lines = buildChangeOrderLines(rows, { defaultAmount: '10', lineOverrides })

  assert.deepEqual(lines.map((line) => line.amount), [10, 25.5, 10])
  assert.deepEqual(lines.map((line) => line.ownAmount), [false, true, false])
  assert.equal(lines[1].ownScope, false)

  const changed = buildChangeOrderLines(rows, { defaultAmount: '12', lineOverrides })
  assert.deepEqual(changed.map((line) => line.amount), [12, 25.5, 12])
})

test('setting and clearing overrides never changes the object it was given', () => {
  const start = { 1: { scope: 'Own scope' } }
  const withAmount = setLineOverride(start, [1, 3], 'amount', '5')

  assert.deepEqual(start, { 1: { scope: 'Own scope' } })
  assert.deepEqual(withAmount, {
    1: { scope: 'Own scope', amount: '5' },
    3: { amount: '5' },
  })

  const cleared = clearLineOverrides(withAmount, [1])
  assert.deepEqual(cleared, { 3: { amount: '5' } })
  assert.deepEqual(withAmount[1], { scope: 'Own scope', amount: '5' })
})

test('an own empty amount is kept as empty, not replaced by the default', () => {
  const lineOverrides = setLineOverride({}, [1], 'amount', '')
  const [first, second] = buildChangeOrderLines(rows, { defaultAmount: '10', lineOverrides })

  assert.equal(first.amount, null)
  assert.equal(second.amount, 10)
})

test('the total adds the lines in exact cents', () => {
  const lines = buildChangeOrderLines(
    [{ lotId: 1 }, { lotId: 2 }, { lotId: 3 }],
    { defaultAmount: '0.10', defaultScope: 'x' },
  )
  assert.equal(summarizeChangeOrderLines(lines).total, 0.3)

  const rosa = buildChangeOrderLines(rows, {
    defaultScope: 'Doors',
    lineOverrides: {
      1: { amount: '1804.00' },
      2: { amount: '1804.00' },
      3: { amount: '1804.92' },
    },
  })
  assert.equal(summarizeChangeOrderLines(rosa).total, 5412.92)
})

test('the summary counts lots with no amount, no scope and their own values', () => {
  const lineOverrides = setLineOverride({}, [3], 'scope', 'Replace door')
  const lines = buildChangeOrderLines(rows, { defaultAmount: '', lineOverrides })
  const summary = summarizeChangeOrderLines(lines)

  assert.equal(summary.lots, 3)
  assert.equal(summary.priced, 0)
  assert.equal(summary.unpriced, 3)
  assert.equal(summary.withoutScope, 2)
  assert.equal(summary.own, 1)
  assert.equal(summary.total, null)
  assert.equal(summary.min, null)
})

test('the summary gives the lowest and highest amount', () => {
  const lineOverrides = setLineOverride({}, [3], 'amount', '403.01')
  const lines = buildChangeOrderLines(rows, { defaultAmount: '184.18', lineOverrides })
  const summary = summarizeChangeOrderLines(lines)

  assert.equal(summary.min, 184.18)
  assert.equal(summary.max, 403.01)
  assert.equal(summary.total, 771.37)
})

test('a value typed back to the default is not a value of its own', () => {
  const defaults = { scope: 'Replace door', amount: '1689.60' }
  const changed = setLineOverride({}, [1], 'amount', '1689.70', defaults)
  assert.deepEqual(changed, { 1: { amount: '1689.70' } })

  const back = setLineOverride(changed, [1], 'amount', '1689.60', defaults)
  assert.deepEqual(back, {})

  const [first] = buildChangeOrderLines(rows, { defaultAmount: '1689.60', lineOverrides: back })
  assert.equal(first.ownAmount, false)
  assert.equal(summarizeChangeOrderLines(buildChangeOrderLines(rows, {
    defaultAmount: '1689.60',
    lineOverrides: back,
  })).own, 0)
})

test('going back to the default keeps the other own value of the Lot', () => {
  const defaults = { scope: 'Replace door', amount: '10' }
  const start = { 1: { scope: 'Own scope', amount: '25' } }

  assert.deepEqual(setLineOverride(start, [1], 'amount', '10', defaults), { 1: { scope: 'Own scope' } })
})

test('an amount that means the same number as the default is dropped', () => {
  const overrides = { 1: { amount: '1689.6' }, 2: { amount: '1689.7', scope: 'Own' }, 3: { scope: 'Own' } }

  assert.deepEqual(
    dropAmountsEqualToDefault(overrides, '1689.60'),
    { 2: { amount: '1689.7', scope: 'Own' }, 3: { scope: 'Own' } },
  )
  assert.deepEqual(dropAmountsEqualToDefault({ 1: { amount: '' } }, ''), { 1: { amount: '' } })
})

test('a line without a lot starts empty and every new one has an id of its own', () => {
  const one = addPlaceLine([])
  assert.deepEqual(one, [{ id: 1, location: '', scope: '', amount: '' }])

  const two = addPlaceLine(one)
  assert.deepEqual(two.map((place) => place.id), [1, 2])

  // A removed line never hands its id to a line that is still there.
  const gap = removePlaceLine(two, 1)
  assert.deepEqual(addPlaceLine(gap).map((place) => place.id), [2, 3])
})

test('changing or removing a line without a lot never touches the others or the original', () => {
  const start = addPlaceLine(addPlaceLine([]))
  const named = updatePlaceLine(start, 2, { location: 'Sales Office', amount: '250.50' })

  assert.deepEqual(start[1], { id: 2, location: '', scope: '', amount: '' })
  assert.deepEqual(named[0], start[0])
  assert.deepEqual(named[1], { id: 2, location: 'Sales Office', scope: '', amount: '250.50' })

  const rest = removePlaceLine(named, 1)
  assert.deepEqual(rest.map((place) => place.id), [2])
  assert.equal(named.length, 2)
})

test('the amount of a line without a lot is a number, or null while it is empty', () => {
  const [office, restroom] = buildPlaceLines([
    { id: 1, location: 'Sales Office', scope: 'Electronic locks', amount: '250.50' },
    { id: 2, location: 'Restroom', scope: 'Credit', amount: '-20' },
  ])
  assert.equal(office.amount, 250.5)
  assert.equal(restroom.amount, -20)
  assert.equal(office.amountText, '250.50')
  assert.equal(buildPlaceLines([{ id: 3, location: '', scope: '', amount: '' }])[0].amount, null)
  assert.deepEqual(buildPlaceLines(), [])
})

test('the total adds the lots and the lines without a lot, in exact cents', () => {
  const lines = buildChangeOrderLines(rows, { defaultScope: 'Add attic ladder', defaultAmount: '0.10' })
  const places = buildPlaceLines([
    { id: 1, location: 'Sales Office', scope: 'Electronic locks', amount: '0.20' },
    { id: 2, location: 'Restroom', scope: 'Credit', amount: '-0.05' },
  ])
  const summary = summarizeChangeOrderLines(lines, places)

  assert.equal(summary.total, 0.45)
  // The figures per lot are about the lots only.
  assert.equal(summary.lots, 3)
  assert.equal(summary.min, 0.1)
  assert.equal(summary.max, 0.1)
  assert.equal(summary.priced, 3)
})

test('an order of only lines without a lot has a total and no lots', () => {
  const places = buildPlaceLines([{ id: 1, location: 'Design Center', scope: 'Paint', amount: '1200' }])
  const summary = summarizeChangeOrderLines([], places)

  assert.equal(summary.total, 1200)
  assert.equal(summary.lots, 0)
  assert.equal(summary.min, null)
  assert.equal(summary.places.count, 1)
})

test('the summary counts the lines without a lot that miss a place, a scope or an amount', () => {
  const places = buildPlaceLines([
    { id: 1, location: 'Sales Office', scope: 'Electronic locks', amount: '250' },
    { id: 2, location: '   ', scope: 'Paint', amount: '' },
    { id: 3, location: 'Restroom', scope: '', amount: '10' },
  ])
  const { places: counts, total } = summarizeChangeOrderLines([], places)

  assert.deepEqual(counts, { count: 3, unnamed: 1, unpriced: 1, withoutScope: 1 })
  assert.equal(total, 260)
  assert.equal(summarizeChangeOrderLines([]).places.count, 0)
  assert.equal(summarizeChangeOrderLines([]).total, null)
})
