export function isRoleAllowed(role, allowedRoles) {
  return !allowedRoles?.length || allowedRoles.includes(role)
}

// Who works in each area. ADMIN is in every list. These mirror the roles the
// database checks, so a button is only offered to someone who can use it.
export const PLANNING_ROLES = ['ADMIN', 'PROJECT_MANAGEMENT'] // Jobs, Plans & Options, Pricing, Change Orders
export const BILLING_ROLES = ['ADMIN', 'ACCOUNTING'] // Draw & Invoice, Builder Setup
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
  billing: pageRoles(BILLING_ROLES),
  scheduling: pageRoles(SCHEDULING_ROLES),
  customerService: pageRoles(CUSTOMER_SERVICE_ROLES),
  admin: pageRoles(ADMIN_ROLES),
}
