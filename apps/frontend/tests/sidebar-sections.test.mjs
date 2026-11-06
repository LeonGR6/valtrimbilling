import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_ROLES, pageRoles, ADMIN_ROLES } from '../src/features/auth/authorization/roleAccess.js'
import { sectionsForRole } from '../src/components/layout/Sidebar/sidebarSections.js'

// The menu as the Sidebar declares it, without the icons.
const sections = [
  {
    label: 'OPERATION',
    items: [{ label: 'Jobs', path: '/jobs' }, { label: 'Sequence Sheets', path: '/sequence-sheets' }, { label: 'Calendar', path: '/calendar' }],
  },
  {
    label: 'BILLING',
    items: [{ label: 'Draw & Invoice Packages', path: '/draw-invoice' }, { label: 'Extra / Change Orders', path: '/change-orders' }],
  },
  {
    label: 'PRICING',
    items: [{ label: 'Proposals' }, { label: 'Plan Pricing', path: '/pricing' }, { label: 'Builder Setup', path: '/builder-draw-schedules' }],
  },
  { label: 'CUSTOMER SERVICE', items: [{ label: 'Customer Service', path: '/customer-service' }] },
  { label: 'REPORTING', items: [{ label: 'Reports' }] },
  {
    label: 'CATALOGS',
    items: [
      { label: 'Company Contacts', path: '/people' },
      { label: 'Builder Contacts', path: '/builder-contacts' },
      { label: 'Builder Types', children: [{ label: 'Single Family' }] },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [{ label: 'Users & Roles', path: '/users' }, { label: 'Settings' }],
  },
]

const accessByPath = new Map([
  ['/jobs', PAGE_ROLES.planning],
  ['/sequence-sheets', PAGE_ROLES.scheduling],
  ['/calendar', PAGE_ROLES.scheduling],
  ['/draw-invoice', PAGE_ROLES.billing],
  ['/change-orders', PAGE_ROLES.planning],
  ['/pricing', PAGE_ROLES.planning],
  ['/builder-draw-schedules', PAGE_ROLES.billing],
  ['/customer-service', PAGE_ROLES.customerService],
  ['/people', PAGE_ROLES.admin],
  ['/builder-contacts', PAGE_ROLES.admin],
  ['/users', ADMIN_ROLES],
])
const availablePaths = new Set(accessByPath.keys())

function menuOf(role) {
  return sectionsForRole(sections, role, { accessByPath, availablePaths }).map((section) => ({
    section: section.label,
    pages: section.items.filter((item) => item.path).map((item) => item.label),
  }))
}

test('ADMIN sees every page', () => {
  const pages = menuOf('ADMIN').flatMap(({ pages: items }) => items)

  assert.equal(pages.length, accessByPath.size)
  assert.equal(menuOf('ADMIN').length, sections.length)
})

test('PROJECT_MANAGEMENT sees Jobs, Pricing and Change Orders only', () => {
  assert.deepEqual(menuOf('PROJECT_MANAGEMENT'), [
    { section: 'OPERATION', pages: ['Jobs'] },
    { section: 'BILLING', pages: ['Extra / Change Orders'] },
    { section: 'PRICING', pages: ['Plan Pricing'] },
    { section: 'REPORTING', pages: [] },
  ])
})

test('ACCOUNTING sees Draw & Invoice and Builder Setup only', () => {
  assert.deepEqual(menuOf('ACCOUNTING'), [
    { section: 'BILLING', pages: ['Draw & Invoice Packages'] },
    { section: 'PRICING', pages: ['Builder Setup'] },
    { section: 'REPORTING', pages: [] },
  ])
})

test('SCHEDULING sees the Calendar and the Sequence Sheets only', () => {
  assert.deepEqual(menuOf('SCHEDULING'), [
    { section: 'OPERATION', pages: ['Sequence Sheets', 'Calendar'] },
    { section: 'REPORTING', pages: [] },
  ])
})

test('CUSTOMER_SERVICE sees Customer Service only', () => {
  assert.deepEqual(menuOf('CUSTOMER_SERVICE'), [
    { section: 'CUSTOMER SERVICE', pages: ['Customer Service'] },
    { section: 'REPORTING', pages: [] },
  ])
})

test('the observers see every page except Users, and no empty heading', () => {
  for (const role of ['FIELD', 'READ_ONLY']) {
    const menu = menuOf(role)
    const pages = menu.flatMap(({ pages: items }) => items)

    assert.equal(pages.length, accessByPath.size - 1, role)
    assert.ok(!pages.includes('Users & Roles'), role)
    assert.ok(!menu.some(({ section }) => section === 'ADMINISTRATION'), role)
  }
})

test('a section of placeholders alone keeps its heading, as it always did', () => {
  const placeholders = [{ label: 'REPORTING', items: [{ label: 'Reports' }] }]
  const menu = sectionsForRole(placeholders, 'READ_ONLY', {
    accessByPath: new Map(),
    availablePaths: new Set(),
  })

  assert.equal(menu.length, 1)
})

test('pageRoles keeps the order of the working roles first', () => {
  assert.deepEqual(pageRoles(['ADMIN', 'ACCOUNTING']), ['ADMIN', 'ACCOUNTING', 'FIELD', 'READ_ONLY'])
})
