import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ADMIN_ROLES,
  BILLING_ROLES,
  CUSTOMER_SERVICE_ROLES,
  PAGE_ROLES,
  PLANNING_ROLES,
  SCHEDULING_ROLES,
  canWork,
  isRoleAllowed,
  pageRoles,
} from '../src/features/auth/authorization/roleAccess.js'

const ROLES = [
  'ADMIN',
  'ACCOUNTING',
  'PROJECT_MANAGEMENT',
  'SCHEDULING',
  'CUSTOMER_SERVICE',
  'FIELD',
  'READ_ONLY',
]

test('a route without configured roles remains available', () => {
  assert.equal(isRoleAllowed('FIELD'), true)
})

test('the users route accepts administrators', () => {
  assert.equal(isRoleAllowed('ADMIN', ['ADMIN']), true)
})

test('the users route rejects every other role', () => {
  for (const role of ROLES.filter((item) => item !== 'ADMIN')) {
    assert.equal(isRoleAllowed(role, ['ADMIN']), false, role)
  }
})

test('each role works in its own area and ADMIN works in all of them', () => {
  const areas = {
    PROJECT_MANAGEMENT: PLANNING_ROLES,
    ACCOUNTING: BILLING_ROLES,
    SCHEDULING: SCHEDULING_ROLES,
    CUSTOMER_SERVICE: CUSTOMER_SERVICE_ROLES,
  }

  for (const [role, own] of Object.entries(areas)) {
    for (const [, workingRoles] of Object.entries(areas)) {
      assert.equal(canWork(role, workingRoles), workingRoles === own, `${role} in ${workingRoles}`)
    }
    assert.equal(canWork(role, ADMIN_ROLES), false, `${role} is not an administrator`)
  }
  for (const workingRoles of [...Object.values(areas), ADMIN_ROLES]) {
    assert.equal(canWork('ADMIN', workingRoles), true)
  }
})

test('observers work in no area', () => {
  for (const role of ['FIELD', 'READ_ONLY', undefined, null]) {
    for (const workingRoles of [
      PLANNING_ROLES,
      BILLING_ROLES,
      SCHEDULING_ROLES,
      CUSTOMER_SERVICE_ROLES,
      ADMIN_ROLES,
    ]) {
      assert.equal(canWork(role, workingRoles), false, String(role))
    }
  }
})

test('a page is opened by the roles that work there and by the observers', () => {
  assert.deepEqual(
    [...pageRoles(['ADMIN', 'SCHEDULING'])].sort(),
    ['ADMIN', 'FIELD', 'READ_ONLY', 'SCHEDULING'],
  )
})

test('every role opens exactly its own pages and Home', () => {
  const opens = (role) => Object.entries(PAGE_ROLES)
    .filter(([, roles]) => isRoleAllowed(role, roles))
    .map(([area]) => area)
    .sort()

  assert.deepEqual(opens('ADMIN'), ['admin', 'billing', 'customerService', 'planning', 'scheduling'])
  assert.deepEqual(opens('PROJECT_MANAGEMENT'), ['planning'])
  assert.deepEqual(opens('ACCOUNTING'), ['billing'])
  assert.deepEqual(opens('SCHEDULING'), ['scheduling'])
  assert.deepEqual(opens('CUSTOMER_SERVICE'), ['customerService'])
  // The observers look at every page except Users, which is not an area page.
  assert.deepEqual(opens('FIELD'), ['admin', 'billing', 'customerService', 'planning', 'scheduling'])
  assert.deepEqual(opens('READ_ONLY'), ['admin', 'billing', 'customerService', 'planning', 'scheduling'])
})

test('every page except Home says who may open it', () => {
  const source = readFileSync(new URL('../src/routes/navigation.jsx', import.meta.url), 'utf8')
  const pages = source.match(/\bpath: '/g)?.length ?? 0
  const guarded = source.match(/\ballowedRoles:/g)?.length ?? 0

  assert.ok(pages > 10)
  assert.equal(guarded, pages - 1, 'a page was added without allowedRoles')
})
