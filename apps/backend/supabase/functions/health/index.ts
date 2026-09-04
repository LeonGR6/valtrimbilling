// Deployment smoke test, and the reference for how the other functions are
// shaped: preflight first, one try/catch, JSON out either way, never a bare
// 500 with no message.
//
// Read only. It reports that the function deployed, that Postgres answers, and
// whether a JWT reached the function -- nothing more. The write path is proven
// by users-admin, which writes for a reason.
//
// verify_jwt is off for this one (see config.toml) so it answers without a
// signed-in user. That is only acceptable because it exposes no data. Any
// function that touches real records leaves verify_jwt at its default.

import { handlePreflight, json } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    // Who is calling, if anyone. An anonymous call reports caller: null; the
    // point is to show the JWT does arrive when the app sends one.
    const {
      data: { user },
    } = await userClient(req).auth.getUser()

    // A head count touches the table without returning any row, which keeps
    // this endpoint from leaking anything while still proving the connection.
    const { count, error } = await serviceClient()
      .from('app_users')
      .select('id', { count: 'exact', head: true })

    if (error) throw error

    return json({
      ok: true,
      database: 'reachable',
      userCount: count,
      caller: user ? { id: user.id, email: user.email } : null,
    })
  } catch (error) {
    return json({ ok: false, error: (error as Error).message }, 500)
  }
})
