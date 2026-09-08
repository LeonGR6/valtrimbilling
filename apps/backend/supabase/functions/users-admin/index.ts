// The half of the users CRUD that cannot run in the browser.
//
// Reading users can go through PostgREST, where RLS controls visibility.
// Identity and access mutations go through this trusted boundary because they
// require either the Auth Admin API or service-role access; neither belongs in
// a browser.
//
// One function handles every admin action instead of three tiny ones. That is
// Supabase's own advice (fewer, larger functions: less cold start, less to
// deploy) and it keeps the admin check in a single place.
//
// POST body: { action: 'create' | 'deactivate' | 'reactivate', ... }

import { handlePreflight, json } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

const ROLES = [
  'ADMIN',
  'ACCOUNTING',
  'PROJECT_MANAGEMENT',
  'SCHEDULING',
  'FIELD',
  'READ_ONLY',
] as const

type Role = (typeof ROLES)[number]

interface CreatePayload {
  email: string
  name: string
  password: string
  phone?: string
  role?: Role
  allProjects?: boolean
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405)
  }

  try {
    // Authorize before doing anything else. The caller's own client is used on
    // purpose: reading their profile through RLS proves the token is valid and
    // that the row is really theirs. Asking the service client "what role does
    // this id have" would prove neither.
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
      case 'create':
        return await createUser(body as CreatePayload)
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

// The form is validated in the browser too, but that validation is a courtesy
// to the person typing -- it is not a control. Anything that reaches the
// database is checked here as well.
function validateCreate(payload: CreatePayload): string | null {
  if (!payload.email?.includes('@')) return 'Enter a valid email address.'
  if (!payload.name?.trim()) return 'Enter the user’s name.'
  if (!payload.password || payload.password.length < 8) {
    return 'The password must be at least 8 characters.'
  }
  if (payload.role && !ROLES.includes(payload.role)) {
    return `Unknown role: ${payload.role}`
  }
  return null
}

async function createUser(payload: CreatePayload): Promise<Response> {
  const invalid = validateCreate(payload)
  if (invalid) return json({ error: invalid }, 400)

  const db = serviceClient()
  const email = payload.email.trim().toLowerCase()

  // Creating the identity also creates the profile row: the trigger on
  // auth.users fires in the same transaction, reading the name out of the
  // metadata passed here.
  //
  // email_confirm skips the confirmation mail because an admin is creating
  // this account deliberately. Switch to inviteUserByEmail() once SMTP is
  // configured and the person should pick their own password.
  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password: payload.password,
    email_confirm: true,
    user_metadata: { name: payload.name.trim() },
  })

  if (createError) {
    // 422 is what the Auth API returns for an email already registered.
    const status = createError.status === 422 ? 409 : 500
    return json({ error: createError.message }, status)
  }

  // The trigger filled in id, name and email. The rest of the record is the
  // app's business and is set here.
  const { data: profile, error: profileError } = await db
    .from('app_users')
    .update({
      phone: payload.phone?.trim() || null,
      role: payload.role ?? 'READ_ONLY',
      all_projects: payload.allProjects ?? true,
    })
    .eq('id', created.user.id)
    .select()
    .single()

  if (profileError) {
    // The identity exists but the profile could not be completed. Roll the
    // identity back rather than leaving a user who can sign in with a role
    // nobody chose.
    await db.auth.admin.deleteUser(created.user.id)
    return json({ error: profileError.message }, 500)
  }

  return json({ user: profile }, 201)
}

// Users are never deleted -- they are referenced by the invoices and draws
// they created. Two things happen instead, and both are needed:
//
//   is_active = false   every RLS policy goes through has_app_role(), which
//                       matches nothing for an inactive user, so they lose
//                       access to every table at once.
//   ban                 an already-issued JWT stays valid until it expires.
//                       Banning stops it being refreshed and ends the session.
async function setActive(userId: string, isActive: boolean): Promise<Response> {
  if (!userId) return json({ error: 'Missing userId.' }, 400)

  const db = serviceClient()

  // Deactivating the last admin locks everyone out of user management for
  // good: no admin left means no one can call this function to undo it, and
  // the way back is editing the table by hand.
  if (!isActive) {
    const { count } = await db
      .from('app_users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'ADMIN')
      .eq('is_active', true)
      .neq('id', userId)

    if (!count) {
      return json({ error: 'This is the last active admin.' }, 409)
    }
  }

  const { data: profile, error } = await db
    .from('app_users')
    .update({ is_active: isActive })
    .eq('id', userId)
    .select()
    .single()

  if (error) return json({ error: error.message }, 500)

  await db.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : '876000h',
  })

  return json({ user: profile })
}
