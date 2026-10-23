import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPastedCells,
  createBulkRow,
  createExistingRows,
  describeBulkResult,
  describeBulkSummary,
  evaluateBulkChanges,
  isBlankRow,
  looksLikeHeader,
  parseSpreadsheetText,
  revertedRow,
  withTrailingBlankRow,
} from '../src/features/jobs/utils/bulkPlanOptions.js'
import { getJobPlanUsage } from '../src/features/jobs/utils/planUsage.js'
import { toBulkChangeResult } from '../src/features/jobs/services/jobPlanRecord.js'

const row = (plan, code = '', description = '', planName = '') => createBulkRow({ plan, code, description, planName })
const jobPlans = () => [
  { id: 1, code: '2-ADA', name: 'Two-story', options: [
    { id: 10, code: 'OPT 1', description: 'Covered patio' },
    { id: 11, code: 'OPT 2', description: 'Extra outlet' },
    { id: 12, code: 'OPT 3', description: 'Gas stub' },
  ] },
  { id: 2, code: '3-B', name: '', options: [{ id: 20, code: 'OPT 1', description: 'Patio' }] },
  { id: 3, code: '4-C', name: '', options: [] },
]
const evaluate = ({ edit = (rows) => rows, added = [], deleted = [] } = {}) => {
  const existing = edit(createExistingRows(jobPlans()))
  return evaluateBulkChanges({ existing, added, deleted: new Set(deleted) })
}
const setRow = (rows, id, values) => rows.map((item) => (item.id === id ? { ...item, ...values } : item))
const empty = { new_plans: [], option_adds: [], plan_updates: [], option_updates: [], deleted_plans: [], deleted_options: [] }

test('the Job’s Plans and Options are rows: a Plan, then its Options', () => {
  const rows = createExistingRows(jobPlans())

  assert.deepEqual(rows.map(({ id, kind }) => [id, kind]), [
    ['plan-1', 'plan'], ['option-10', 'option'], ['option-11', 'option'], ['option-12', 'option'],
    ['plan-2', 'plan'], ['option-20', 'option'], ['plan-3', 'plan'],
  ])
  assert.equal(rows[0].optionCount, 3)
  assert.equal(rows[0].planName, 'Two-story')
  assert.deepEqual(rows[1].original, { code: 'OPT 1', description: 'Covered patio' })
  assert.equal(rows[1].planId, 1)
})

test('nothing edited is nothing to save', () => {
  const result = evaluate()

  assert.deepEqual(result.payload, empty)
  assert.equal(result.canSave, false)
  assert.equal(result.hasChanges, false)
  assert.equal(describeBulkSummary(result.summary), 'No changes yet')
  assert.equal(result.existing.get('option-10').status, 'unchanged')
})

test('an edited Plan or Option is a change, and says what it was', () => {
  const result = evaluate({
    edit: (rows) => setRow(setRow(setRow(rows, 'plan-1', { plan: ' 2-ada-x ', planName: 'Two story' }), 'option-11', { description: 'Outlet in garage' }), 'option-12', { code: 'opt 3b' }),
  })

  assert.deepEqual(result.payload.plan_updates, [{ id: 1, code: '2-ADA-X', name: 'Two story' }])
  assert.deepEqual(result.payload.option_updates, [
    { id: 11, code: 'OPT 2', description: 'Outlet in garage' },
    { id: 12, code: 'OPT 3B', description: 'Gas stub' },
  ])
  assert.equal(result.existing.get('plan-1').was, '2-ADA · Two-story')
  assert.equal(result.existing.get('option-11').was, 'OPT 2 · Extra outlet')
  assert.equal(describeBulkSummary(result.summary), '3 edited')
  assert.equal(result.canSave, true)
})

test('typing back what it was is not a change, and a reverted row is what it was', () => {
  const edited = setRow(createExistingRows(jobPlans()), 'option-10', { description: 'Something else' })
  const back = setRow(edited, 'option-10', { description: ' Covered patio ' })

  assert.equal(evaluateBulkChanges({ existing: back }).summary.optionsEdited, 0)
  assert.equal(evaluateBulkChanges({ existing: edited }).summary.optionsEdited, 1)
  assert.equal(revertedRow(edited.find(({ id }) => id === 'option-10')).description, 'Covered patio')
  // Only the case changing is a change: the description is shown as it is typed.
  assert.equal(evaluateBulkChanges({ existing: setRow(createExistingRows(jobPlans()), 'option-10', { description: 'covered patio' }) }).summary.optionsEdited, 1)
})

test('a Plan with its Options can be deleted, and an Option alone', () => {
  const result = evaluate({ deleted: ['plan-1', 'option-20'] })

  assert.deepEqual(result.payload.deleted_plans, [1])
  // The Options of a deleted Plan go with it, so they are not sent on their own.
  assert.deepEqual(result.payload.deleted_options, [20])
  assert.equal(result.existing.get('option-10').status, 'delete-with-plan')
  assert.equal(result.existing.get('option-20').status, 'delete')
  assert.equal(result.summary.optionsDeletedWithPlans, 3)
  assert.equal(describeBulkSummary(result.summary), '2 to delete')
  // An Option edited and then deleted is just deleted.
  const both = evaluate({ edit: (rows) => setRow(rows, 'option-11', { code: '' }), deleted: ['option-11'] })
  assert.equal(both.summary.errorCount, 0)
  assert.deepEqual(both.payload.deleted_options, [11])
})

test('what has to be fixed in what already exists', () => {
  const result = evaluate({
    edit: (rows) => setRow(setRow(setRow(setRow(rows, 'plan-1', { plan: '' }), 'plan-3', { planName: 'N'.repeat(101) }), 'option-10', { code: '' }), 'option-11', { description: 'Gas stub', code: 'opt 3' }),
  })

  assert.equal(result.existing.get('plan-1').status, 'error')
  assert.match(result.existing.get('plan-1').message, /Plan code/)
  assert.match(result.existing.get('plan-3').message, /Plan name is over/)
  assert.equal(result.existing.get('option-10').status, 'error')
  assert.match(result.existing.get('option-11').message, /already has an Option/)
  assert.equal(result.canSave, false)
})

test('two Plans cannot end with the same code, and a deleted Plan keeps its code', () => {
  const duplicate = evaluate({ edit: (rows) => setRow(rows, 'plan-2', { plan: '2-ada' }) })
  assert.equal(duplicate.existing.get('plan-2').status, 'error')
  assert.match(duplicate.existing.get('plan-2').message, /Another Plan/)

  const swapped = evaluate({ edit: (rows) => setRow(setRow(rows, 'plan-2', { plan: '4-C' }), 'plan-3', { plan: '3-B' }) })
  assert.equal(swapped.summary.errorCount, 0)
  assert.deepEqual(swapped.payload.plan_updates.map(({ id, code }) => [id, code]), [[2, '4-C'], [3, '3-B']])

  const taken = evaluate({ edit: (rows) => setRow(rows, 'plan-2', { plan: '4-C' }), deleted: ['plan-3'] })
  assert.match(taken.existing.get('plan-2').message, /deleting/)
})

test('added rows: a blank Plan takes the Plan above, so it is typed once', () => {
  const result = evaluate({ added: [
    row('5-D', 'OPT 1', 'Patio'),
    row('', 'OPT 2', 'Outlet'),
    row('', 'OPT 3', 'Gas stub'),
    row('6-E', 'OPT 1', 'Patio'),
  ] })

  assert.deepEqual(result.added.map(({ planCode, status }) => [planCode, status]), [
    ['5-D', 'option'], ['5-D', 'option'], ['5-D', 'option'], ['6-E', 'option'],
  ])
  assert.deepEqual(result.payload.new_plans, [
    { code: '5-D', name: '', options: [{ code: 'OPT 1', description: 'Patio' }, { code: 'OPT 2', description: 'Outlet' }, { code: 'OPT 3', description: 'Gas stub' }] },
    { code: '6-E', name: '', options: [{ code: 'OPT 1', description: 'Patio' }] },
  ])
  assert.equal(describeBulkSummary(result.summary), '2 new plans · 4 new options')
  assert.equal(result.canSave, true)
})

test('added rows for a Plan the Job has become Options of that Plan, by id', () => {
  const result = evaluate({ added: [row('2-ada', 'opt 9', 'Nine'), row('', 'OPT 1', 'covered patio'), row('3-B', 'OPT 5')] })

  assert.deepEqual(result.payload.option_adds, [
    { plan_id: 1, code: 'OPT 9', description: 'Nine' },
    { plan_id: 2, code: 'OPT 5', description: 'OPT 5' },
  ])
  assert.deepEqual(result.payload.new_plans, [])
  assert.deepEqual(result.added.map(({ status }) => status), ['option', 'skip', 'option'])
  assert.equal(result.summary.optionsSkipped, 1)
  assert.deepEqual(result.added.map(({ creates }) => creates), [false, false, false])
})

test('an added Option is compared with what the Plan has now: an edited Option, or one being deleted', () => {
  const edited = evaluate({
    edit: (rows) => setRow(rows, 'option-10', { description: 'Big patio' }),
    added: [row('2-ADA', 'OPT 1', 'Big patio'), row('', 'OPT 1', 'Covered patio')],
  })
  assert.deepEqual(edited.added.map(({ status }) => status), ['skip', 'option'])

  const deleted = evaluate({ deleted: ['option-10'], added: [row('2-ADA', 'OPT 1', 'Covered patio')] })
  assert.equal(deleted.added[0].status, 'option')
  const withPlan = evaluate({ deleted: ['plan-1'], added: [row('2-ADA', 'OPT 1', 'Covered patio')] })
  assert.equal(withPlan.added[0].status, 'error')
  assert.match(withPlan.added[0].message, /being deleted/)
})

test('an added Plan named like one that was renamed in the same save is a new Plan', () => {
  const result = evaluate({ edit: (rows) => setRow(rows, 'plan-1', { plan: '2-ADX' }), added: [row('2-ADA', 'OPT 1', 'x'), row('2-ADX', 'OPT 7', 'y')] })

  assert.deepEqual(result.payload.new_plans.map(({ code }) => code), ['2-ADA'])
  assert.deepEqual(result.payload.option_adds, [{ plan_id: 1, code: 'OPT 7', description: 'y' }])
})

test('added rows: rows with only a Plan, repeated Options, names and what has to be fixed', () => {
  const result = evaluate({ added: [
    row('7-F', '', '', 'Seven F'),
    row('', 'OPT 1', 'a', 'Ignored later'),
    row('', 'OPT 1', 'A'),
    row('3-B'),
    row('', '', 'Description without OPT #'),
    row('X'.repeat(41), 'OPT 1', 'x'),
    createBulkRow(),
  ] })

  assert.deepEqual(result.added.map(({ status }) => status), ['plan', 'option', 'skip', 'plan', 'error', 'error', 'empty'])
  assert.equal(result.added[3].message, 'The Plan is already in the Job.')
  assert.deepEqual(result.payload.new_plans, [{ code: '7-F', name: 'Seven F', options: [{ code: 'OPT 1', description: 'a' }] }])
  assert.equal(result.summary.errorCount, 2)
  assert.equal(result.canSave, false)
  assert.equal(evaluate({ added: [row('', 'OPT 1', 'No plan above')] }).added[0].status, 'error')
})

test('a row with a mistake keeps its Plan for the rows below, unless the Plan itself is not valid', () => {
  const result = evaluate({ added: [
    row('5-D', 'OPT 1', 'a'),
    row('6-E', '', 'Description without OPT #'),
    row('', 'OPT 2', 'belongs to 6-E'),
    row('X'.repeat(41), 'OPT 1', 'x'),
    row('', 'OPT 2', 'no valid Plan above'),
  ] })

  assert.deepEqual(result.added.map(({ status }) => status), ['option', 'error', 'option', 'error', 'error'])
  assert.equal(result.added[2].planCode, '6-E')
  assert.deepEqual(result.payload.new_plans.map(({ code, options }) => [code, options.length]), [['5-D', 1], ['6-E', 1]])
  assert.match(result.added[4].message, /Enter the Plan/)
})

test('the grid always ends with one blank row', () => {
  assert.equal(withTrailingBlankRow([row('A', 'B', 'C')]).length, 2)
  assert.equal(isBlankRow(withTrailingBlankRow([row('A', 'B', 'C')]).at(-1)), true)
  const rows = [row('A'), createBulkRow()]
  assert.equal(withTrailingBlankRow(rows), rows)
  assert.equal(withTrailingBlankRow([]).length, 1)
})

test('cells copied from a spreadsheet are read by line and by tab', () => {
  assert.deepEqual(parseSpreadsheetText('2-ADA\tOPT 1\tCovered patio\r\n\tOPT 2\t"Extra, ""big"" outlet"\r\n'), [
    ['2-ADA', 'OPT 1', 'Covered patio'],
    ['', 'OPT 2', 'Extra, "big" outlet'],
  ])
  assert.deepEqual(parseSpreadsheetText('only one'), [['only one']])
  assert.deepEqual(parseSpreadsheetText(''), [])
})

test('pasting fills from the cell it lands on, adds rows and leaves out a header line', () => {
  assert.equal(looksLikeHeader(['Plan', 'OPT #', 'Description']), true)
  assert.equal(looksLikeHeader(['Plan', 'OPT #', 'Description', 'Plan name (optional)']), true)
  assert.equal(looksLikeHeader(['2-ADA', 'OPT 1', 'Covered patio']), false)

  const pasted = applyPastedCells([createBulkRow()], 0, 0, [['Plan', 'OPT #', 'Description'], ['2-ADA', 'OPT 1', 'Patio'], ['', 'OPT 2', 'Outlet']])
  assert.equal(pasted.length, 3)
  assert.deepEqual(pasted.slice(0, 2).map(({ plan, code, description }) => [plan, code, description]), [
    ['2-ADA', 'OPT 1', 'Patio'], ['', 'OPT 2', 'Outlet'],
  ])
  assert.equal(isBlankRow(pasted.at(-1)), true)

  const column = applyPastedCells([row('4-C'), createBulkRow()], 0, 1, [['OPT 1', 'Patio'], ['OPT 2', 'Outlet']])
  assert.deepEqual(column.slice(0, 2).map(({ plan, code, description }) => [plan, code, description]), [
    ['4-C', 'OPT 1', 'Patio'], ['', 'OPT 2', 'Outlet'],
  ])
  const wide = applyPastedCells([createBulkRow()], 0, 2, [['desc', 'plan name', 'extra']])
  assert.deepEqual([wide[0].description, wide[0].planName], ['desc', 'plan name'])
})

test('which Plans and Options the Lots use', () => {
  const job = {
    sequenceSheet: {
      plans: jobPlans(),
      phases: [
        { id: 1, lots: [{ id: 1, planId: 1, optionIds: [10, 11] }, { id: 2, planId: 1, optionIds: [] }, { id: 3, planId: 2, optionIds: [] }] },
        { id: 2, lots: [{ id: 4, planId: 1, optionIds: [10] }] },
      ],
    },
  }
  const { plans, options } = getJobPlanUsage(job)

  assert.deepEqual([...plans.entries()], [[1, 3], [2, 1]])
  assert.deepEqual([...options.entries()], [[10, 2], [11, 1]])
  assert.equal(getJobPlanUsage({}).plans.size, 0)
})

test('what is told after saving', () => {
  const base = { plansCreated: 0, plansRestored: 0, plansUpdated: 0, plansDeleted: 0, optionsCreated: 0, optionsUpdated: 0, optionsDeleted: 0, optionsSkipped: 0 }

  assert.equal(describeBulkResult({ ...base, plansCreated: 2, plansRestored: 1, optionsCreated: 40 }), 'Added 3 plans and 40 options.')
  assert.equal(describeBulkResult({ ...base, optionsCreated: 1, optionsSkipped: 1 }), 'Added 1 option. 1 option was already there.')
  assert.equal(describeBulkResult({ ...base, plansUpdated: 1, optionsUpdated: 3, plansDeleted: 1, optionsDeleted: 2 }), 'Edited 4. Deleted 3.')
  assert.equal(describeBulkResult({ ...base, optionsSkipped: 3 }), 'Nothing new to add. 3 options were already there.')
  assert.equal(describeBulkSummary({ newPlans: 1, newOptions: 12, plansEdited: 1, optionsEdited: 1, plansDeleted: 1, optionsDeleted: 0 }), '1 new plan · 12 new options · 2 edited · 1 to delete')
})

test('the database answer is read with the names the page uses', () => {
  assert.deepEqual(toBulkChangeResult({
    plans_created: 2, plans_restored: 1, plans_updated: 3, plans_deleted: 1, options_created: 5, options_skipped: 2, options_updated: 4, options_deleted: 6,
    plans: [{ id: '7', code: 'A', created: true }], option_plan_ids: [1, '2'],
  }), {
    plansCreated: 2, plansRestored: 1, plansUpdated: 3, plansDeleted: 1, optionsCreated: 5, optionsSkipped: 2, optionsUpdated: 4, optionsDeleted: 6,
    plans: [{ id: 7, code: 'A', created: true }], optionPlanIds: [1, 2],
  })
  assert.equal(toBulkChangeResult(null).optionsCreated, 0)
})
