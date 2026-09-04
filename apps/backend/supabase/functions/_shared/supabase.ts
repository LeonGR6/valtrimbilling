// Two ways to reach Postgres from a function, and picking the wrong one is how
// permission models get quietly bypassed:
//
//   userClient(req)   forwards the caller's JWT. RLS applies, so the query sees
//                     exactly what that user is allowed to see. This is the
//                     default and covers almost everything.
//
//   serviceClient()   uses the service role key and BYPASSES RLS COMPLETELY.
//                     It is not "the admin user" -- it is no user at all, and
//                     no policy will stop it. Only reach for it when the system
//                     itself is the actor: scheduled jobs, integration tokens,
//                     writes the caller must not be able to make directly.
//
// If a function uses serviceClient() to do something on a user's behalf, that
// function is now the only thing standing between that user and every row in
// the table. Check permissions yourself before you write.
//
// All four variables below are injected by the platform. Nothing to configure.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export function userClient(req: Request): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: req.headers.get('Authorization') ?? '' },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function serviceClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
