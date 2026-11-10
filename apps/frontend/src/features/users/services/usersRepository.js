import { requireSupabase } from '../../../services/api.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'
import { PUBLIC_APP_URL } from '../../../config/appConfig.js'

const FUNCTION_NAME = 'users-admin'

async function invokeUsersAdmin(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })

  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The user administration request failed.'), { cause: error })
  }

  return data
}

// Always the public app, never window.location: an invitation sent from localhost must not send the
// new user to localhost.
function invitationRedirectUrl() {
  return new URL('/accept-invite', PUBLIC_APP_URL).toString()
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
    redirectTo: invitationRedirectUrl(),
  })
  return data.user
}

export async function resendInvitation(userId) {
  const data = await invokeUsersAdmin({
    action: 'resend-invite',
    userId,
    redirectTo: invitationRedirectUrl(),
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
