import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cellKey,
  cleanPastedPrice,
  editableText,
  effectivePlanPrice,
  evaluateWorksheet,
  keepPhasePriceChanges,
  parseCell,
} from '../src/features/plan-pricing/utils/priceWorksheet.js'

const plans = [
  {
    id: 1,
    code: '2450',
    price: 1000,
    hardwarePrice: 80,
    options: [
      { id: 10, code: 'OPT-10', price: 300, priceNotApplicable: false },
      { id: 11, code: 'OPT-11', price: 0, priceNotApplicable: true },
      { id: 12, code: 'OPT-12', price: null, priceNotApplicable: false },
    ],
  },
  { id: 2, code: '1980', price: null, hardwarePrice: null, options: [] },
]
const drafts = (entries) => new Map(entries)

test('a field starts with the current price, NA or nothing', () => {
  assert.equal(editableText('plan', plans[0]), '1000.00')
  assert.equal(editableText('hardware', plans[0]), '80.00')
  assert.equal(editableText('option', plans[0].options[0]), '300.00')
  assert.equal(editableText('option', plans[0].options[1]), 'NA')
  assert.equal(editableText('option', plans[0].options[2]), '')
  assert.equal(editableText('plan', plans[1]), '')
})

test('typed prices follow the rules of the single-price dialog', () => {
  assert.deepEqual(parseCell('plan', ' 245000.5 '), { ok: true, value: { amount: 245000.5 } })
  assert.equal(parseCell('plan', '12.345').ok, false)
  assert.equal(parseCell('plan', '-5').ok, false)
  assert.deepEqual(parseCell('option', '-120.50'), { ok: true, value: { amount: -120.5, notApplicable: false } })
  assert.deepEqual(parseCell('option', 'na'), { ok: true, value: { amount: 0, notApplicable: true } })
  assert.deepEqual(parseCell('option', '   '), { empty: true })
  assert.equal(parseCell('hardware', '50', { planPrice: null }).ok, false)
  assert.equal(parseCell('hardware', '50', { planPrice: 1000 }).ok, true)
})

test('only prices that really changed count, and a Plan with its Hardware is one change', () => {
  const result = evaluateWorksheet(plans, drafts([
    [cellKey.plan(1), '1200.00'],
    [cellKey.hardware(1), '80'],
    [cellKey.option(10), '300.00'],
    [cellKey.option(12), '150'],
  ]), { separateHardwarePrice: true })

  assert.equal(result.errors.size, 0)
  assert.equal(result.changes.length, 2)
  assert.deepEqual(result.changes[0].to, { base: 1200, hardware: 80 })
  assert.equal(result.changes[0].baseChanged, true)
  assert.equal(result.changes[0].hardwareChanged, false)
  assert.equal(result.changes[1].type, 'option')
  assert.deepEqual(result.changes[1].to, { amount: 150, notApplicable: false })
  assert.deepEqual([...result.changedKeys].sort(), [cellKey.option(12), cellKey.plan(1)].sort())
  assert.equal(result.changeCount, 2)
})

test('an Option can switch to and from NA', () => {
  const toNa = evaluateWorksheet(plans, drafts([[cellKey.option(10), 'NA']]))
  assert.equal(toNa.changes[0].to.notApplicable, true)

  const fromNa = evaluateWorksheet(plans, drafts([[cellKey.option(11), '25']]))
  assert.deepEqual(fromNa.changes[0].from, { price: 0, notApplicable: true })
  assert.deepEqual(fromNa.changes[0].to, { amount: 25, notApplicable: false })

  const same = evaluateWorksheet(plans, drafts([[cellKey.option(11), 'na']]))
  assert.equal(same.changes.length, 0)
})

test('a price cannot be taken away, and a blank field that was never priced is no change', () => {
  const result = evaluateWorksheet(plans, drafts([
    [cellKey.plan(1), ''],
    [cellKey.option(10), ' '],
    [cellKey.option(12), ''],
    [cellKey.plan(2), ''],
  ]))

  assert.deepEqual([...result.errors.keys()].sort(), [cellKey.option(10), cellKey.plan(1)].sort())
  assert.equal(result.changes.length, 0)
})

test('Hardware needs a Plan price, typed in the same edit or already saved', () => {
  const needsPlanPrice = evaluateWorksheet(plans, drafts([[cellKey.hardware(2), '40']]), { separateHardwarePrice: true })
  assert.equal(needsPlanPrice.errors.get(cellKey.hardware(2)), 'Set the Plan price before the Hardware price.')

  const together = evaluateWorksheet(plans, drafts([
    [cellKey.plan(2), '900'],
    [cellKey.hardware(2), '40'],
  ]), { separateHardwarePrice: true })
  assert.equal(together.errors.size, 0)
  assert.deepEqual(together.changes[0].to, { base: 900, hardware: 40 })
})

test('invalid fields report their message and do not become changes', () => {
  const result = evaluateWorksheet(plans, drafts([
    [cellKey.plan(1), 'abc'],
    [cellKey.option(10), '1.234'],
  ]))

  assert.equal(result.errors.size, 2)
  assert.equal(result.changes.length, 0)
})

test('the Phases of the Job narrow to the prices that were saved', () => {
  const lot = (extra) => ({
    lot_id: 5, lot_number: '5', plan_id: 1, plan_code: '2450', plan_change: null, option_changes: [], ...extra,
  })
  const rows = [
    {
      phase_id: 1,
      code: '2B',
      lots: [
        // Plan 1 and Option 10 were saved: both stay. Option 11 was not saved: it goes.
        lot({ plan_change: { to_base: 10 }, option_changes: [{ option_id: 10 }, { option_id: 11 }] }),
        // Only Option 11 differs here, and it was not saved: the Lot goes.
        lot({ lot_id: 6, option_changes: [{ option_id: 11 }] }),
      ],
    },
    // Plan 2 was not saved: its older price is not offered.
    { phase_id: 2, code: '3A', lots: [lot({ lot_id: 9, plan_id: 2, plan_change: { to_base: 20 } })] },
  ]
  const changes = [
    { type: 'plan', plan: { id: 1 } },
    { type: 'option', plan: { id: 1 }, option: { id: 10 } },
  ]

  const kept = keepPhasePriceChanges(rows, changes)

  assert.equal(kept.length, 1)
  assert.equal(kept[0].phase_id, 1)
  assert.deepEqual(kept[0].lots.map((item) => item.lot_id), [5])
  assert.deepEqual(kept[0].lots[0].plan_change, { to_base: 10 })
  assert.deepEqual(kept[0].lots[0].option_changes, [{ option_id: 10 }])

  // An Option saved alone does not bring the Plan price of its Lots along.
  const optionOnly = keepPhasePriceChanges(rows, [{ type: 'option', plan: { id: 1 }, option: { id: 10 } }])
  assert.equal(optionOnly[0].lots[0].plan_change, null)
  assert.deepEqual(keepPhasePriceChanges(null, changes), [])
  assert.deepEqual(keepPhasePriceChanges(rows, []), [])
})

test('Hardware is checked against the Plan price being typed, else the saved one', () => {
  assert.equal(effectivePlanPrice(plans[0], drafts([[cellKey.plan(1), '1500']])), 1500)
  assert.equal(effectivePlanPrice(plans[0], drafts([[cellKey.plan(1), 'abc']])), 1000)
  assert.equal(effectivePlanPrice(plans[1], drafts([])), null)
})

test('pasted spreadsheet values are tidied', () => {
  assert.equal(cleanPastedPrice('$1,200.50'), '1200.50')
  assert.equal(cleanPastedPrice(' 300 '), '300')
  assert.equal(cleanPastedPrice('(120.50)'), '-120.50')
  assert.equal(cleanPastedPrice('-45'), '-45')
  assert.equal(cleanPastedPrice('NA'), 'NA')
  assert.equal(cleanPastedPrice(''), '')
})
