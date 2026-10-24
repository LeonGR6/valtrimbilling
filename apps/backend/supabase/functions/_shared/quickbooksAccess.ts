// The sign-in and role check shared by the QuickBooks functions that act on a
// Package: only an ADMIN or ACCOUNTING user may.

import type { User } from '@supabase/supabase-js'
import { json } from './cors.ts'
import { userClient } from './supabase.ts'

const ALLOWED_ROLES = ['ADMIN', 'ACCOUNTING']

export type InvoiceAccess =
  | { user: null; response: Response }
  | { user: User; response: null }

export async function requireInvoiceUser(req: Request, action: string): Promise<InvoiceAccess> {
  const caller = userClient(req)
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser()

  if (authError || !user) return { user: null, response: json({ error: 'Sign in first.' }, 401) }

  const { data: profile, error: profileError } = await caller
    .from('app_users')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
    return {
      user: null,
      response: json({ error: `Only an administrator or accounting user can ${action}.` }, 403),
    }
  }

  return { user, response: null }
}

export function requirePackageId(body: unknown) {
  const packageId = (body as { packageId?: unknown } | null)?.packageId
  return Number.isInteger(packageId) && (packageId as number) > 0 ? (packageId as number) : null
}
