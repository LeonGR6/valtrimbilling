export function isRoleAllowed(role, allowedRoles) {
  return !allowedRoles?.length || allowedRoles.includes(role)
}
