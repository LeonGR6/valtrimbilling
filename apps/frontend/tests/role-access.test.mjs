import test from 'node:test'
import assert from 'node:assert/strict'
import { isRoleAllowed } from '../src/features/auth/authorization/roleAccess.js'

test('a route without configured roles remains available', () => {
  assert.equal(isRoleAllowed('FIELD'), true)
})

test('the users route accepts administrators', () => {
  assert.equal(isRoleAllowed('ADMIN', ['ADMIN']), true)
})

test('the users route rejects every other role', () => {
  const roles = [
    'ACCOUNTING',
    'PROJECT_MANAGEMENT',
    'SCHEDULING',
    'FIELD',
    'READ_ONLY',
  ]

  for (const role of roles) {
    assert.equal(isRoleAllowed(role, ['ADMIN']), false)
  }
})
