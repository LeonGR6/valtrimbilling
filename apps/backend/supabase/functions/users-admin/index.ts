// Trusted user administration boundary.
//
// The browser can never receive the service-role key. Every action first
// validates the caller's JWT and ADMIN profile, then uses the Auth Admin API
// and the valtrim profile/access tables on the caller's behalf.
//
// POST body: { action: 'list' | 'invite' | 'resend-invite' | 'update' | 'deactivate' | 'reactivate', ... }

import { handlePreflight, json } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'
import { getAccountStatus } from './user-status.ts'
import type { User } from 'jsr:@supabase/supabase-js@2'

const ROLES = [
  'ADMIN',
  'ACCOUNTING',
  'PROJECT_MANAGEMENT',
  'SCHEDULING',
  'FIELD',
  'READ_ONLY',
] as const

type Role = (typeof ROLES)[number]

const SCOPED_ROLES: readonly Role[] = [
  'PROJECT_MANAGEMENT',
  'SCHEDULING',
  'FIELD',
]

interface UserPayload {
  email: string
  name: string
  phone?: string
  role?: Role
  allProjects?: boolean
  projectAccess?: number[]
}

interface InvitePayload extends UserPayload {
  redirectTo: string
}

interface ResendInvitePayload {
  userId: string
  redirectTo: string
}

interface UpdatePayload extends UserPayload {
  userId: string
  isActive: boolean
}

type AdminClient = ReturnType<typeof serviceClient>

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405)
  }

  try {
    const caller = userClient(req)
    const {
      data: { user },
      error: authError,
    } = await caller.auth.getUser()

    if (authError || !user) {
      return json({ error: 'Sign in first.' }, 401)
    }

    const { data: profile } = await caller
      .from('app_users')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (!profile?.is_active || profile.role !== 'ADMIN') {
      return json({ error: 'Only an admin can manage users.' }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body?.action) {
      return json({ error: 'Missing action.' }, 400)
    }

    switch (body.action) {
      case 'list':
        return await listUsers()
      case 'invite':
        return await inviteUser(body as InvitePayload, user.id)
      case 'resend-invite':
        return await resendInvitation(body as ResendInvitePayload)
      case 'update':
        return await updateUser(body as UpdatePayload, user.id)
      case 'deactivate':
        return await setActive(body.userId, false)
      case 'reactivate':
        return await setActive(body.userId, true)
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400)
    }
  } catch (error) {
    return json({ error: (error as Error).message }, 500)
  }
})

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value as Role)
}

function normalizedAccess(payload: UserPayload) {
  const role = payload.role ?? 'READ_ONLY'
  const allProjects = SCOPED_ROLES.includes(role)
    ? payload.allProjects ?? true
    : true
  const projectAccess = allProjects
    ? []
    : [...new Set(payload.projectAccess ?? [])]

  return { role, allProjects, projectAccess }
}

function validateUser(payload: UserPayload): string | null {
  if (!payload.email?.trim().includes('@')) return 'Enter a valid email address.'
  if (!payload.name?.trim()) return 'Enter the user’s name.'
  if (payload.role && !isRole(payload.role)) return `Unknown role: ${payload.role}`
  if (
    payload.projectAccess !== undefined
    && (!Array.isArray(payload.projectAccess)
      || payload.projectAccess.some((id) => !Number.isSafeInteger(id) || id <= 0))
  ) {
    return 'Project access contains an invalid community.'
  }

  const { role, allProjects, projectAccess } = normalizedAccess(payload)
  if (SCOPED_ROLES.includes(role) && !allProjects && projectAccess.length === 0) {
    return 'Select at least one project for this role.'
  }

  return null
}

function validateUserId(userId: unknown): userId is string {
  return typeof userId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
}

function validateRedirect(redirectTo: string): string | null {
  try {
    const url = new URL(redirectTo)
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/accept-invite') {
      return 'The invitation redirect must point to /accept-invite.'
    }
    return null
  } catch {
    return 'The invitation redirect is invalid.'
  }
}

async function validateCommunities(
  db: AdminClient,
  communityIds: number[],
): Promise<string | null> {
  if (communityIds.length === 0) return null

  const { data, error } = await db
    .from('communities')
    .select('id')
    .in('id', communityIds)

  if (error) throw error
  if (data.length !== communityIds.length) {
    return 'One or more selected projects no longer exist.'
  }
  return null
}

async function replaceCommunityAccess(
  db: AdminClient,
  userId: string,
  communityIds: number[],
  grantedBy: string,
) {
  // Delete first so a partial failure removes access instead of accidentally
  // retaining communities that the administrator intended to revoke.
  const { error: deleteError } = await db
    .from('user_community_access')
    .delete()
    .eq('user_id', userId)

  if (deleteError) throw deleteError
  if (communityIds.length === 0) return

  const { error: insertError } = await db
    .from('user_community_access')
    .insert(communityIds.map((communityId) => ({
      user_id: userId,
      community_id: communityId,
      granted_by: grantedBy,
    })))

  if (insertError) throw insertError
}

function toUser(
  profile: Record<string, unknown>,
  projectAccess: number[],
  authUser: User,
) {
  const lastSignInAt = authUser.last_sign_in_at ?? null
  const lastPasswordLoginAt = profile.last_password_login_at ?? null

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    phone: profile.phone ?? '',
    role: profile.role,
    allProjects: profile.all_projects,
    isActive: profile.is_active,
    accountStatus: getAccountStatus(
      Boolean(profile.is_active),
      authUser.email_confirmed_at,
      lastPasswordLoginAt as string | null,
    ),
    emailConfirmedAt: authUser.email_confirmed_at ?? null,
    createdAt: authUser.created_at,
    invitedAt: authUser.invited_at ?? null,
    confirmationSentAt: authUser.confirmation_sent_at ?? null,
    lastSignInAt,
    lastPasswordLoginAt,
    lastLoginAt: lastPasswordLoginAt,
    projectAccess,
  }
}

async function getUser(db: AdminClient, userId: string) {
  const [profileResult, accessResult, authResult] = await Promise.all([
    db
      .from('app_users')
      .select('id, name, email, phone, role, all_projects, is_active, last_login_at, last_password_login_at')
      .eq('id', userId)
      .single(),
    db
      .from('user_community_access')
      .select('community_id')
      .eq('user_id', userId),
    db.auth.admin.getUserById(userId),
  ])

  if (profileResult.error) throw profileResult.error
  if (accessResult.error) throw accessResult.error
  if (authResult.error) throw authResult.error

  return toUser(
    profileResult.data,
    accessResult.data.map(({ community_id }) => Number(community_id)),
    authResult.data.user,
  )
}

async function listAllAuthUsers(db: AdminClient): Promise<User[]> {
  const users: User[] = []
  const perPage = 1000

  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) throw error

    users.push(...data.users)
    if (data.users.length < perPage) return users
  }
}

async function listUsers(): Promise<Response> {
  const db = serviceClient()
  const [profilesResult, accessResult, communitiesResult, authUsers] = await Promise.all([
    db
      .from('app_users')
      .select('id, name, email, phone, role, all_projects, is_active, last_login_at, last_password_login_at')
      .order('name', { ascending: true }),
    db
      .from('user_community_access')
      .select('user_id, community_id'),
    db
      .from('communities')
      .select('id, code, name, is_active')
      .order('name', { ascending: true }),
    listAllAuthUsers(db),
  ])

  if (profilesResult.error) return json({ error: profilesResult.error.message }, 500)
  if (accessResult.error) return json({ error: accessResult.error.message }, 500)
  if (communitiesResult.error) return json({ error: communitiesResult.error.message }, 500)

  const accessByUser = new Map<string, number[]>()
  for (const access of accessResult.data) {
    const current = accessByUser.get(access.user_id) ?? []
    current.push(Number(access.community_id))
    accessByUser.set(access.user_id, current)
  }

  const authByUserId = new Map(authUsers.map((user) => [user.id, user]))
  const missingAuthUser = profilesResult.data.find(
    (profile) => !authByUserId.has(profile.id),
  )
  if (missingAuthUser) {
    return json({ error: `Auth user not found for profile ${missingAuthUser.id}.` }, 500)
  }

  return json({
    users: profilesResult.data.map((profile) => (
      toUser(
        profile,
        accessByUser.get(profile.id) ?? [],
        authByUserId.get(profile.id)!,
      )
    )),
    communities: communitiesResult.data.map((community) => ({
      id: Number(community.id),
      code: community.code ?? '',
      name: community.name,
      isActive: community.is_active,
    })),
  })
}

async function inviteUser(payload: InvitePayload, callerId: string): Promise<Response> {
  const invalid = validateUser(payload) ?? validateRedirect(payload.redirectTo)
  if (invalid) return json({ error: invalid }, 400)

  const db = serviceClient()
  const email = payload.email.trim().toLowerCase()
  const name = payload.name.trim()
  const { role, allProjects, projectAccess } = normalizedAccess(payload)
  const invalidCommunities = await validateCommunities(db, projectAccess)
  if (invalidCommunities) return json({ error: invalidCommunities }, 400)

  // Supabase creates auth.users, sends the SMTP invitation and runs the
  // database trigger that creates valtrim.app_users. The invitation opens the
  // dedicated /accept-invite view so the person chooses their own password.
  const { data: invited, error: inviteError } = await db.auth.admin.inviteUserByEmail(
    email,
    {
      data: { name },
      redirectTo: payload.redirectTo,
    },
  )

  if (inviteError) {
    const status = inviteError.status === 422 ? 409 : 500
    return json({ error: inviteError.message }, status)
  }

  const { error: profileError } = await db
    .from('app_users')
    .update({
      name,
      phone: payload.phone?.trim() || null,
      role,
      all_projects: allProjects,
      is_active: true,
    })
    .eq('id', invited.user.id)

  if (profileError) {
    await db.auth.admin.deleteUser(invited.user.id)
    return json({ error: profileError.message }, 500)
  }

  try {
    await replaceCommunityAccess(db, invited.user.id, projectAccess, callerId)
    return json({ user: await getUser(db, invited.user.id) }, 201)
  } catch (error) {
    await db.auth.admin.deleteUser(invited.user.id)
    return json({ error: (error as Error).message }, 500)
  }
}

async function resendInvitation(payload: ResendInvitePayload): Promise<Response> {
  if (!validateUserId(payload.userId)) return json({ error: 'Invalid userId.' }, 400)

  const invalidRedirect = validateRedirect(payload.redirectTo)
  if (invalidRedirect) return json({ error: invalidRedirect }, 400)

  const db = serviceClient()
  const [profileResult, authResult] = await Promise.all([
    db
      .from('app_users')
      .select('id, name, email, is_active')
      .eq('id', payload.userId)
      .maybeSingle(),
    db.auth.admin.getUserById(payload.userId),
  ])

  if (profileResult.error) return json({ error: profileResult.error.message }, 500)
  if (authResult.error) {
    const status = authResult.error.status === 404 ? 404 : 500
    return json({ error: authResult.error.message }, status)
  }
  if (!profileResult.data) return json({ error: 'User not found.' }, 404)
  if (!profileResult.data.is_active) {
    return json({ error: 'Reactivate this user before resending the invitation.' }, 409)
  }

  const authUser = authResult.data.user
  if (authUser.email_confirmed_at) {
    return json({ error: 'Only pending invitations can be resent.' }, 409)
  }
  if (!authUser.email) return json({ error: 'The invited user has no email address.' }, 409)

  const { error: inviteError } = await db.auth.admin.inviteUserByEmail(
    authUser.email,
    {
      data: {
        ...authUser.user_metadata,
        name: profileResult.data.name,
      },
      redirectTo: payload.redirectTo,
    },
  )

  if (inviteError) {
    const status = inviteError.status === 429
      ? 429
      : inviteError.status === 422
        ? 409
        : 500
    return json({ error: inviteError.message }, status)
  }

  return json({ user: await getUser(db, payload.userId) })
}

async function otherActiveAdminExists(db: AdminClient, userId: string) {
  const { count, error } = await db
    .from('app_users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'ADMIN')
    .eq('is_active', true)
    .neq('id', userId)

  if (error) throw error
  return Boolean(count)
}

async function updateUser(payload: UpdatePayload, callerId: string): Promise<Response> {
  if (!validateUserId(payload.userId)) return json({ error: 'Invalid userId.' }, 400)

  const invalid = validateUser(payload)
  if (invalid) return json({ error: invalid }, 400)
  if (typeof payload.isActive !== 'boolean') {
    return json({ error: 'Missing user status.' }, 400)
  }

  const db = serviceClient()
  const { data: current, error: currentError } = await db
    .from('app_users')
    .select('role, is_active')
    .eq('id', payload.userId)
    .maybeSingle()

  if (currentError) return json({ error: currentError.message }, 500)
  if (!current) return json({ error: 'User not found.' }, 404)

  const { role, allProjects, projectAccess } = normalizedAccess(payload)
  const removesActiveAdmin = current.role === 'ADMIN'
    && current.is_active
    && (role !== 'ADMIN' || !payload.isActive)

  if (removesActiveAdmin && !(await otherActiveAdminExists(db, payload.userId))) {
    return json({ error: 'This is the last active admin.' }, 409)
  }

  const invalidCommunities = await validateCommunities(db, projectAccess)
  if (invalidCommunities) return json({ error: invalidCommunities }, 400)

  const email = payload.email.trim().toLowerCase()
  const name = payload.name.trim()
  const { error: authUpdateError } = await db.auth.admin.updateUserById(payload.userId, {
    email,
    user_metadata: { name },
    ban_duration: payload.isActive ? 'none' : '876000h',
  })

  if (authUpdateError) {
    const status = authUpdateError.status === 422 ? 409 : 500
    return json({ error: authUpdateError.message }, status)
  }

  const { error: profileError } = await db
    .from('app_users')
    .update({
      name,
      email,
      phone: payload.phone?.trim() || null,
      role,
      all_projects: allProjects,
      is_active: payload.isActive,
    })
    .eq('id', payload.userId)

  if (profileError) return json({ error: profileError.message }, 500)

  try {
    await replaceCommunityAccess(db, payload.userId, projectAccess, callerId)
    return json({ user: await getUser(db, payload.userId) })
  } catch (error) {
    return json({ error: (error as Error).message }, 500)
  }
}

async function setActive(userId: unknown, isActive: boolean): Promise<Response> {
  if (!validateUserId(userId)) return json({ error: 'Invalid userId.' }, 400)

  const db = serviceClient()
  const { data: current, error: currentError } = await db
    .from('app_users')
    .select('role, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (currentError) return json({ error: currentError.message }, 500)
  if (!current) return json({ error: 'User not found.' }, 404)

  if (
    !isActive
    && current.role === 'ADMIN'
    && current.is_active
    && !(await otherActiveAdminExists(db, userId))
  ) {
    return json({ error: 'This is the last active admin.' }, 409)
  }

  if (!isActive) {
    const { error: profileError } = await db
      .from('app_users')
      .update({ is_active: false })
      .eq('id', userId)
    if (profileError) return json({ error: profileError.message }, 500)
  }

  const { error: authUpdateError } = await db.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : '876000h',
  })
  if (authUpdateError) return json({ error: authUpdateError.message }, 500)

  if (isActive) {
    const { error: profileError } = await db
      .from('app_users')
      .update({ is_active: true })
      .eq('id', userId)
    if (profileError) return json({ error: profileError.message }, 500)
  }

  return json({ user: await getUser(db, userId) })
}
