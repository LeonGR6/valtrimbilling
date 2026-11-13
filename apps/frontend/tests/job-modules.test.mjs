import assert from 'node:assert/strict'
import test from 'node:test'
import { canOpenBuilderJobs, JOB_MODULES, jobModulesForRole } from '../src/features/jobs/utils/jobModules.js'
import { isRoleAllowed } from '../src/features/auth/authorization/roleAccess.js'

const idsFor = (role) => jobModulesForRole(role).map(({ id }) => id)

test('each role gets the tabs of the Job pages it can open', () => {
  assert.deepEqual(idsFor('ADMIN'), ['plans-options', 'sequence-sheet', 'plan-pricing', 'draw-invoice'])
  assert.deepEqual(idsFor('PROJECT_MANAGEMENT'), ['plans-options', 'plan-pricing'])
  assert.deepEqual(idsFor('ACCOUNTING'), ['draw-invoice'])
  assert.deepEqual(idsFor('DRAW_INVOICE'), ['draw-invoice'])
  assert.deepEqual(idsFor('SCHEDULING'), ['sequence-sheet'])
  assert.deepEqual(idsFor('CUSTOMER_SERVICE'), [])
})

test('the observers see every tab', () => {
  for (const role of ['FIELD', 'READ_ONLY']) {
    assert.deepEqual(idsFor(role), JOB_MODULES.map(({ id }) => id), role)
  }
})

test('a tab is never offered to a role that its page would deny', () => {
  for (const role of ['ADMIN', 'PROJECT_MANAGEMENT', 'ACCOUNTING', 'DRAW_INVOICE', 'SCHEDULING', 'CUSTOMER_SERVICE', 'FIELD', 'READ_ONLY']) {
    for (const module of jobModulesForRole(role)) {
      assert.ok(isRoleAllowed(role, module.roles), `${role} / ${module.id}`)
    }
  }
})

test('every tab leads to the page of its Job', () => {
  const paths = Object.fromEntries(JOB_MODULES.map((module) => [module.id, module.path(4, 9)]))

  assert.equal(paths['plans-options'], '/jobs/builder/4/job/9/plans-options')
  assert.equal(paths['sequence-sheet'], '/sequence-sheets/builder/4/job/9')
  assert.equal(paths['plan-pricing'], '/pricing/builder/4/job/9')
  assert.equal(paths['draw-invoice'], '/draw-invoice/builder/4/job/9')
})

test('only the roles that open Jobs get the way back to the Builder jobs', () => {
  assert.equal(canOpenBuilderJobs('ADMIN'), true)
  assert.equal(canOpenBuilderJobs('PROJECT_MANAGEMENT'), true)
  assert.equal(canOpenBuilderJobs('READ_ONLY'), true)
  assert.equal(canOpenBuilderJobs('ACCOUNTING'), false)
  assert.equal(canOpenBuilderJobs('DRAW_INVOICE'), false)
  assert.equal(canOpenBuilderJobs('SCHEDULING'), false)
  assert.equal(canOpenBuilderJobs('CUSTOMER_SERVICE'), false)
})
