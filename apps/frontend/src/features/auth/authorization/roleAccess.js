export function isRoleAllowed(role, allowedRoles) {
  return !allowedRoles?.length || allowedRoles.includes(role)
}

// Who works in each area. ADMIN is in every list. These mirror the roles the
// database checks, so a button is only offered to someone who can use it.
export const PLANNING_ROLES = ['ADMIN', 'PROJECT_MANAGEMENT'] // Jobs, Plans & Options, Pricing, Change Orders
// Draw & Invoice: Packages, Documents, notes and the QuickBooks invoice of a Package.
// DRAW_INVOICE works only here; ACCOUNTING also owns Builder Setup and A/R.
export const DRAW_INVOICE_ROLES = ['ADMIN', 'ACCOUNTING', 'DRAW_INVOICE']
export const BILLING_ROLES = ['ADMIN', 'ACCOUNTING'] // Builder Setup, and the A/R tab of Draw & Invoice
export const SCHEDULING_ROLES = ['ADMIN', 'SCHEDULING'] // Calendar, Sequence Sheets
export const CUSTOMER_SERVICE_ROLES = ['ADMIN', 'CUSTOMER_SERVICE']
export const ADMIN_ROLES = ['ADMIN'] // People, Builder Contacts, Users

// FIELD and READ_ONLY work in no area of their own; they open every page to
// look, and the database lets them change nothing.
const OBSERVER_ROLES = ['FIELD', 'READ_ONLY']

// The roles that may open a page: the ones that work there, plus the observers.
export function pageRoles(...workingRoles) {
  return [...new Set([...workingRoles.flat(), ...OBSERVER_ROLES])]
}

export function canWork(role, workingRoles) {
  return isRoleAllowed(role, workingRoles)
}

// Who may open the pages of each area.
export const PAGE_ROLES = {
  planning: pageRoles(PLANNING_ROLES),
  drawInvoice: pageRoles(DRAW_INVOICE_ROLES),
  billing: pageRoles(BILLING_ROLES),
  scheduling: pageRoles(SCHEDULING_ROLES),
  customerService: pageRoles(CUSTOMER_SERVICE_ROLES),
  admin: pageRoles(ADMIN_ROLES),
}

// Who sees the A/R tab inside Draw & Invoice: the billing roles and the
// observers, but not the Draw & Invoice role.
export const RECEIVABLES_ROLES = PAGE_ROLES.billing

// Whether the role may open the pages of an area (a key of PAGE_ROLES). A link
// to a page a role cannot open only leads to "Access denied", so it is not shown.
export function canOpenPage(role, area) {
  return isRoleAllowed(role, PAGE_ROLES[area])
}

// Roles with no Home dashboard start on a page of their own: Home reads the
// Calendar, Jobs and collections, which they do not work with.
const START_PAGES = { DRAW_INVOICE: '/draw-invoice' }

export function startPageOf(role) {
  return START_PAGES[role] ?? '/'
}
