import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getAuditActionDetails,
  getAuditModuleLabel,
} from '../src/features/activity-history/data/auditMetadata.js'

test('known audit codes use user-facing labels', () => {
  assert.equal(getAuditActionDetails('ROLE_CHANGED').label, 'Role changed')
  assert.equal(
    getAuditActionDetails('BUILDER_CONTACT_DEACTIVATED').label,
    'Builder contact deactivated',
  )
  assert.equal(getAuditActionDetails('BUILDER_CREATED').label, 'Builder created')
  assert.equal(
    getAuditActionDetails('SUPERVISOR_REACTIVATED').label,
    'Supervisor reactivated',
  )
  assert.equal(getAuditModuleLabel('USERS'), 'Users & Roles')
  assert.equal(getAuditModuleLabel('BUILDERS'), 'Builders')
  assert.equal(getAuditModuleLabel('BUILDER_CONTACTS'), 'Builder Contacts')
  assert.equal(getAuditModuleLabel('PEOPLE'), 'Crews & Foremen')
})

test('future audit codes receive readable fallback labels', () => {
  assert.equal(getAuditActionDetails('JOB_STATUS_CHANGED').label, 'Job status changed')
  assert.equal(getAuditModuleLabel('CUSTOMER_SERVICE'), 'Customer service')
})
