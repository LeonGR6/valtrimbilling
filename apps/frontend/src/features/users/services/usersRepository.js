import { requireSupabase } from '../../../services/api.js'

const FUNCTION_NAME = 'users-admin'

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }

  return error?.message || 'The user administration request failed.'
}

async function invokeUsersAdmin(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })

  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }

  return data
}

function userPayload(user) {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    allProjects: user.allProjects,
    projectAccess: user.projectAccess,
  }
}

export async function listUsers() {
  const data = await invokeUsersAdmin({ action: 'list' })
  return {
    users: data.users ?? [],
    communities: data.communities ?? [],
  }
}

export async function inviteUser(user) {
  const data = await invokeUsersAdmin({
    action: 'invite',
    ...userPayload(user),
    redirectTo: new URL('/accept-invite', window.location.origin).toString(),
  })
  return data.user
}

export async function resendInvitation(userId) {
  const data = await invokeUsersAdmin({
    action: 'resend-invite',
    userId,
    redirectTo: new URL('/accept-invite', window.location.origin).toString(),
  })
  return data.user
}

export async function updateUser(userId, user) {
  const data = await invokeUsersAdmin({
    action: 'update',
    userId,
    ...userPayload(user),
    isActive: user.isActive,
  })
  return data.user
}

export async function setUserActive(userId, isActive) {
  const data = await invokeUsersAdmin({
    action: isActive ? 'reactivate' : 'deactivate',
    userId,
  })
  return data.user
}
