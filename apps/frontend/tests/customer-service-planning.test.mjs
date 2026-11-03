import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasCustomGeneralFixDuration,
  missingRequestPlanningValues,
  planningForTask,
  suggestRequestPlanning,
} from '../src/features/customer-service/utils/customerServicePlanning.js'
import { buildNewRequestDraftFromPdf } from '../src/features/customer-service/utils/pdfExtraction.js'

const item = { description: 'The top part of bathroom door is rubbing. Hinge is loose', requestedAction: 'adjustment',
  suggestedServiceKind: 'Adjustment', suggestedWorkType: null, suggestedServiceTask: 'GENERAL_FIX', assignedToValtrim: true }
const form = { serviceKind: 'Adjustment', workType: '', serviceTask: 'GENERAL_FIX', estimatedDurationMinutes: '', crewSize: '',
  requestedWorkItems: [{ description: item.description }] }

test('opening a saved General fix with empty planning proposes Doors, 30 minutes and one person', () => {
  const before = JSON.stringify(form)
  assert.deepEqual(missingRequestPlanningValues(form, [item]), { workType: 'Doors', estimatedDurationMinutes: 30, crewSize: 1 })
  assert.equal(hasCustomGeneralFixDuration(form), false)
  assert.equal(hasCustomGeneralFixDuration({ ...form, estimatedDurationMinutes: null }), false)
  assert.equal(JSON.stringify(form), before)
})
test('missing-field suggestions preserve manual classification, duration and crew, including invalid supplied values', () => {
  const manual = { ...form, serviceKind: 'Paid Extra', workType: 'Hardware', estimatedDurationMinutes: 75, crewSize: 3 }
  assert.deepEqual(missingRequestPlanningValues(manual, [item]), {})
  assert.equal(hasCustomGeneralFixDuration(manual), true)
  assert.deepEqual(missingRequestPlanningValues({ ...manual, estimatedDurationMinutes: 0, crewSize: 0 }, [item]), {})
})
test('a selected shutter task fills only missing crew and preserves a manually adjusted duration', () => {
  assert.deepEqual(missingRequestPlanningValues({ ...form, workType: 'Moldings', serviceTask: 'SHUTTER_REPLACEMENT', estimatedDurationMinutes: 180 }), { crewSize: 2 })
  assert.deepEqual(planningForTask('SHUTTER_REPLACEMENT', 10), { estimatedDurationMinutes: 120, crewSize: 2 })
  assert.deepEqual(planningForTask('UNRECOGNIZED', 1), { estimatedDurationMinutes: null, crewSize: null })
})
test('empty work cannot preselect a classification or planning requirement', () => {
  assert.deepEqual(missingRequestPlanningValues({ ...form, requestedWorkItems: [{ description: ' ' }] }), {})
  const proposal = suggestRequestPlanning([])
  assert.equal(proposal.serviceTask, '')
  assert.equal(proposal.estimatedDurationMinutes, null)
  assert.equal(proposal.crewSize, null)
})
test('incompatible tasks and classifications remain pending for the complete request', () => {
  const proposal = suggestRequestPlanning([item, { description: 'Replace shelving', suggestedServiceKind: 'Replacement', suggestedWorkType: 'Shelving', suggestedServiceTask: 'SHELVING_REPLACEMENT' }])
  assert.equal(proposal.workType, 'Multiple work types')
  assert.equal(proposal.serviceKind, '')
  assert.equal(proposal.serviceTask, '')
  assert.equal(proposal.estimatedDurationMinutes, null)
  assert.equal(proposal.crewSize, null)
})
test('explicit source conflicts cannot be bypassed by keyword inference', () => {
  const proposal = suggestRequestPlanning([item], { blockedFields: ['workType', 'serviceTask'] })
  assert.equal(proposal.workType, '')
  assert.equal(proposal.serviceTask, '')
  assert.equal(proposal.estimatedDurationMinutes, null)
})
test('PDF/text extraction uses the complete included scope for duration, not the first source item', () => {
  const structured = { document: {}, property: {}, contacts: [], warnings: [], serviceItems: [
    ...Array.from({ length: 7 }, (_, i) => ({ ...item, description: `Adjust door ${i + 1}` })),
    { ...item, description: 'Replace shutters for another vendor', assignedToValtrim: false, suggestedServiceTask: 'SHUTTER_REPLACEMENT' },
    { ...item, description: '', requestedAction: null },
  ] }
  const before = JSON.stringify(structured)
  const result = buildNewRequestDraftFromPdf(structured)
  assert.equal(result.values.estimatedDurationMinutes, 45)
  assert.equal(result.values.crewSize, 1)
  assert.equal(result.values.serviceTask, 'GENERAL_FIX')
  assert.equal(JSON.stringify(structured), before)
})
test('changed descriptions do not recover stale source classifications by their array position', () => {
  const changed = { ...form, serviceKind: '', serviceTask: '', requestedWorkItems: [{ description: 'Replace shelving' }] }
  const patch = missingRequestPlanningValues(changed, [item])
  assert.equal(patch.workType, 'Shelving')
  assert.equal(patch.serviceTask, 'SHELVING_REPLACEMENT')
  assert.equal(patch.estimatedDurationMinutes, 60)
})
