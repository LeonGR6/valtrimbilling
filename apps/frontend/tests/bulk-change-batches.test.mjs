import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BULK_BATCH_SIZE,
  countBulkChanges,
  mergeBulkResults,
  splitBulkChanges,
} from '../src/features/jobs/utils/bulkChangeBatches.js'

const empty = { new_plans: [], option_adds: [], plan_updates: [], option_updates: [], deleted_plans: [], deleted_options: [] }
const options = (count, tag = 'O') => Array.from({ length: count }, (_, index) => ({ code: `${tag}${index}`, description: `${tag} ${index}` }))
const plans = (planCount, optionCount) => Array.from({ length: planCount }, (_, index) => ({
  code: `P${index}`, name: '', options: options(optionCount, `P${index}-`),
}))

test('a small save is one batch, as it was', () => {
  const changes = { ...empty, new_plans: plans(2, 5), deleted_options: [1, 2] }
  const batches = splitBulkChanges(changes)

  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0], changes)
  assert.deepEqual(splitBulkChanges(empty), [])
})

test('the ELM pricing paste (41 Plans, 4387 Options) is cut under the 3000 the database accepts', () => {
  const changes = { ...empty, new_plans: plans(41, 107) }
  assert.equal(countBulkChanges(changes), 41 + 41 * 107)

  const batches = splitBulkChanges(changes)

  assert.ok(batches.length > 1)
  for (const batch of batches) assert.ok(countBulkChanges(batch) <= BULK_BATCH_SIZE)
  assert.ok(BULK_BATCH_SIZE < 3000)
  // Nothing is lost or repeated: every Option of every Plan is in exactly one batch.
  const sent = batches.flatMap((batch) => batch.new_plans.flatMap((plan) => plan.options.map((option) => `${plan.code}/${option.code}`)))
  const expected = changes.new_plans.flatMap((plan) => plan.options.map((option) => `${plan.code}/${option.code}`))
  assert.deepEqual(sent, expected)
})

test('a Plan with more Options than fit goes on in the next batch under the same code', () => {
  const batches = splitBulkChanges({ ...empty, new_plans: plans(1, 25) }, 10)

  assert.deepEqual(batches.map((batch) => countBulkChanges(batch)), [10, 10, 8])
  assert.ok(batches.every((batch) => batch.new_plans.length === 1 && batch.new_plans[0].code === 'P0'))
  assert.equal(batches.reduce((sum, batch) => sum + batch.new_plans[0].options.length, 0), 25)
})

test('a Plan with no Options still goes, and the next one starts where there is room', () => {
  const batches = splitBulkChanges({ ...empty, new_plans: [...plans(1, 0), ...plans(1, 3).map((plan) => ({ ...plan, code: 'Q' }))] }, 10)

  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0].new_plans.map((plan) => plan.code), ['P0', 'Q'])
})

test('the Plan edits stay together, so two Plans can swap codes, and come after the deletions', () => {
  const planUpdates = [{ id: 1, code: 'B', name: '' }, { id: 2, code: 'A', name: '' }]
  const batches = splitBulkChanges({
    ...empty,
    deleted_options: Array.from({ length: 9 }, (_, index) => index + 100),
    plan_updates: planUpdates,
  }, 10)

  assert.equal(batches.length, 2)
  assert.equal(batches[0].deleted_options.length, 9)
  assert.deepEqual(batches[1].plan_updates, planUpdates)
})

test('every kind of change is kept, in the order the database applies them', () => {
  const changes = {
    new_plans: plans(1, 4),
    option_adds: [{ plan_id: 7, code: 'X', description: 'x' }, { plan_id: 7, code: 'Y', description: 'y' }],
    plan_updates: [{ id: 1, code: 'A', name: '' }],
    option_updates: [{ id: 5, code: 'Z', description: 'z' }],
    deleted_plans: [3],
    deleted_options: [8, 9],
  }
  const batches = splitBulkChanges(changes, 4)

  // A Plan split over two batches is counted in both (it is repeated), so the batches add up to one more.
  const planParts = batches.filter((batch) => batch.new_plans.length > 0).length
  assert.equal(batches.reduce((sum, batch) => sum + countBulkChanges(batch), 0), countBulkChanges(changes) + planParts - 1)
  const firstWith = (key) => batches.findIndex((batch) => batch[key].length > 0)
  assert.ok(firstWith('deleted_plans') <= firstWith('plan_updates'))
  assert.ok(firstWith('plan_updates') <= firstWith('option_updates'))
  assert.ok(firstWith('option_updates') <= firstWith('new_plans'))
  assert.ok(firstWith('new_plans') <= firstWith('option_adds'))
})

test('the answers of the batches are added up, and a Plan sent twice counts once', () => {
  const answer = (values) => ({
    plansCreated: 0, plansRestored: 0, plansUpdated: 0, plansDeleted: 0,
    optionsCreated: 0, optionsSkipped: 0, optionsUpdated: 0, optionsDeleted: 0,
    plans: [], optionPlanIds: [], ...values,
  })
  const merged = mergeBulkResults([
    answer({ plansCreated: 1, optionsCreated: 1999, plans: [{ id: 10, code: 'P0', created: true }] }),
    answer({ optionsCreated: 500, optionsSkipped: 2, plans: [{ id: 10, code: 'P0', created: false }], optionPlanIds: [4] }),
    answer({ optionsCreated: 3, optionPlanIds: [4, 5] }),
  ])

  assert.equal(merged.plansCreated, 1)
  assert.equal(merged.optionsCreated, 2502)
  assert.equal(merged.optionsSkipped, 2)
  assert.deepEqual(merged.plans, [{ id: 10, code: 'P0', created: true }])
  assert.deepEqual(merged.optionPlanIds, [4, 5])
})
