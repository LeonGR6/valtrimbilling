import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ADMIN_ROLES,
  BILLING_ROLES,
  CUSTOMER_SERVICE_ROLES,
  DRAW_INVOICE_ROLES,
  PAGE_ROLES,
  PLANNING_ROLES,
  RECEIVABLES_ROLES,
  SCHEDULING_ROLES,
  canOpenPage,
  canWork,
  isRoleAllowed,
  pageRoles,
  startPageOf,
} from '../src/features/auth/authorization/roleAccess.js'

const ROLES = [
  'ADMIN',
  'ACCOUNTING',
  'DRAW_INVOICE',
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
    DRAW_INVOICE: DRAW_INVOICE_ROLES,
    SCHEDULING: SCHEDULING_ROLES,
    CUSTOMER_SERVICE: CUSTOMER_SERVICE_ROLES,
  }

  for (const [role, own] of Object.entries(areas)) {
    for (const [, workingRoles] of Object.entries(areas)) {
      assert.equal(canWork(role, workingRoles), workingRoles === own, `${role} in ${workingRoles}`)
    }
    assert.equal(canWork(role, ADMIN_ROLES), false, `${role} is not an administrator`)
  }
  // ACCOUNTING works in Draw & Invoice like the Draw & Invoice role, and also in Builder Setup.
  assert.equal(canWork('ACCOUNTING', DRAW_INVOICE_ROLES), true)
  assert.equal(canWork('ACCOUNTING', BILLING_ROLES), true)
  assert.equal(canWork('DRAW_INVOICE', BILLING_ROLES), false)
  for (const workingRoles of [...Object.values(areas), ADMIN_ROLES]) {
    assert.equal(canWork('ADMIN', workingRoles), true)
  }
})

test('observers work in no area', () => {
  for (const role of ['FIELD', 'READ_ONLY', undefined, null]) {
    for (const workingRoles of [
      PLANNING_ROLES,
      DRAW_INVOICE_ROLES,
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

  const everyArea = ['admin', 'billing', 'customerService', 'drawInvoice', 'planning', 'scheduling']

  assert.deepEqual(opens('ADMIN'), everyArea)
  assert.deepEqual(opens('PROJECT_MANAGEMENT'), ['planning'])
  assert.deepEqual(opens('ACCOUNTING'), ['billing', 'drawInvoice'])
  assert.deepEqual(opens('DRAW_INVOICE'), ['drawInvoice'])
  assert.deepEqual(opens('SCHEDULING'), ['scheduling'])
  assert.deepEqual(opens('CUSTOMER_SERVICE'), ['customerService'])
  // The observers look at every page except Users, which is not an area page.
  assert.deepEqual(opens('FIELD'), everyArea)
  assert.deepEqual(opens('READ_ONLY'), everyArea)
})

test('the Draw & Invoice role opens Draw & Invoice and no other page', () => {
  assert.equal(canOpenPage('DRAW_INVOICE', 'drawInvoice'), true)
  for (const area of ['billing', 'planning', 'scheduling', 'customerService', 'admin']) {
    assert.equal(canOpenPage('DRAW_INVOICE', area), false, area)
  }
  assert.equal(isRoleAllowed('DRAW_INVOICE', ADMIN_ROLES), false)
})

test('Builder Setup stays with Accounting: the Draw & Invoice role does not open it', () => {
  assert.equal(canOpenPage('ACCOUNTING', 'billing'), true)
  assert.equal(canOpenPage('DRAW_INVOICE', 'billing'), false)
})

test('the A/R tab is for the billing roles and the observers, not for the Draw & Invoice role', () => {
  for (const role of ['ADMIN', 'ACCOUNTING', 'FIELD', 'READ_ONLY']) {
    assert.equal(isRoleAllowed(role, RECEIVABLES_ROLES), true, role)
  }
  for (const role of ['DRAW_INVOICE', 'PROJECT_MANAGEMENT', 'SCHEDULING', 'CUSTOMER_SERVICE']) {
    assert.equal(isRoleAllowed(role, RECEIVABLES_ROLES), false, role)
  }
})

test('the Draw & Invoice role starts on Draw & Invoice, everyone else on Home', () => {
  assert.equal(startPageOf('DRAW_INVOICE'), '/draw-invoice')
  for (const role of ROLES.filter((item) => item !== 'DRAW_INVOICE')) {
    assert.equal(startPageOf(role), '/', role)
  }
  assert.equal(startPageOf(undefined), '/')
})

test('every page except Home says who may open it', () => {
  const source = readFileSync(new URL('../src/routes/navigation.jsx', import.meta.url), 'utf8')
  const pages = source.match(/\bpath: '/g)?.length ?? 0
  const guarded = source.match(/\ballowedRoles:/g)?.length ?? 0

  assert.ok(pages > 10)
  assert.equal(guarded, pages - 1, 'a page was added without allowedRoles')
})

test('every Draw & Invoice route answers to the Draw & Invoice roles, and Builder Setup does not', () => {
  const source = readFileSync(new URL('../src/routes/navigation.jsx', import.meta.url), 'utf8')
  const accessOf = new Map(
    [...source.matchAll(/path: '(\/[^']*)'[\s\S]*?allowedRoles: (\w+)/g)].map(([, path, roles]) => [path, roles]),
  )
  const drawInvoicePaths = [...accessOf.keys()].filter((path) => path.startsWith('/draw-invoice'))

  assert.equal(drawInvoicePaths.length, 4, 'the page and its three contextual routes')
  for (const path of drawInvoicePaths) assert.equal(accessOf.get(path), 'drawInvoicePage', path)
  assert.equal(accessOf.get('/builder-draw-schedules'), 'billingPage')
})
