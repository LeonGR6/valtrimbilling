export const auditActionDetails = {
  USER_INVITED: { label: 'User invited', color: 'info' },
  INVITATION_RESENT: { label: 'Invitation resent', color: 'info' },
  USER_UPDATED: { label: 'User updated', color: 'primary' },
  ROLE_CHANGED: { label: 'Role changed', color: 'warning' },
  PROJECT_ACCESS_CHANGED: { label: 'Project access changed', color: 'warning' },
  USER_DEACTIVATED: { label: 'User deactivated', color: 'error' },
  USER_REACTIVATED: { label: 'User reactivated', color: 'success' },
  BUILDER_CONTACT_CREATED: { label: 'Builder contact created', color: 'info' },
  BUILDER_CONTACT_UPDATED: { label: 'Builder contact updated', color: 'primary' },
  BUILDER_CONTACT_DEACTIVATED: { label: 'Builder contact deactivated', color: 'error' },
  BUILDER_CONTACT_REACTIVATED: { label: 'Builder contact reactivated', color: 'success' },
  BUILDER_CREATED: { label: 'Builder created', color: 'info' },
  BUILDER_UPDATED: { label: 'Builder updated', color: 'primary' },
  BUILDER_DEACTIVATED: { label: 'Builder deactivated', color: 'error' },
  BUILDER_REACTIVATED: { label: 'Builder reactivated', color: 'success' },
  SUPERVISOR_CREATED: { label: 'Supervisor created', color: 'info' },
  SUPERVISOR_UPDATED: { label: 'Supervisor updated', color: 'primary' },
  SUPERVISOR_DEACTIVATED: { label: 'Supervisor deactivated', color: 'error' },
  SUPERVISOR_REACTIVATED: { label: 'Supervisor reactivated', color: 'success' },
  ACTION_REJECTED: { label: 'Action rejected', color: 'error' },
}

export const auditModuleDetails = {
  USERS: { label: 'Users & Roles' },
  BUILDERS: { label: 'Builders' },
  BUILDER_CONTACTS: { label: 'Builder Contacts' },
  PEOPLE: { label: 'Crews & Foremen' },
  JOBS: { label: 'Jobs' },
  CALENDAR: { label: 'Calendar' },
  BILLING: { label: 'Billing' },
  PRICING: { label: 'Pricing' },
}

function titleFromCode(value) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

export function getAuditActionDetails(action) {
  return auditActionDetails[action] ?? {
    label: titleFromCode(action),
    color: 'primary',
  }
}

export function getAuditModuleLabel(module) {
  return auditModuleDetails[module]?.label ?? titleFromCode(module)
}
