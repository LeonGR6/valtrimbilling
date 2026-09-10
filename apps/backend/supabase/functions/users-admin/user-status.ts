export type AccountStatus =
  | 'PENDING_INVITE'
  | 'NEVER_SIGNED_IN'
  | 'ACTIVE'
  | 'INACTIVE'

export function getAccountStatus(
  isActive: boolean,
  emailConfirmedAt?: string | null,
  lastPasswordLoginAt?: string | null,
): AccountStatus {
  if (!isActive) return 'INACTIVE'
  if (!emailConfirmedAt) return 'PENDING_INVITE'
  if (!lastPasswordLoginAt) return 'NEVER_SIGNED_IN'
  return 'ACTIVE'
}
