// Hyphen Requests (ADMIN only): the messages Hyphen's UAT environment sent to the
// SPConnect webhook, read on the server with the teammate project's secret key so the
// browser never holds it (see _shared/spconnectMessages.ts).
//
// POST, no body. Answers { messages } or { error }.

import { handlePreflight, json } from '../_shared/cors.ts'
import { userClient } from '../_shared/supabase.ts'
import { readSpconnectMessages, SpconnectReadError } from '../_shared/spconnectMessages.ts'

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

    const { data: profile, error: profileError } = await caller
      .from('app_users')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) throw profileError
    if (!profile?.is_active || profile.role !== 'ADMIN') {
      return json({ error: 'Only an admin can see the Hyphen requests.' }, 403)
    }

    const messages = await readSpconnectMessages({
      url: Deno.env.get('SPCONNECT_UAT_URL'),
      secretKey: Deno.env.get('SPCONNECT_UAT_SECRET_KEY'),
    })
    return json({ messages })
  } catch (error) {
    if (error instanceof SpconnectReadError) {
      return json({ error: error.message }, error.status)
    }
    console.error('hyphen-messages failed.', error instanceof Error ? error.message : error)
    return json({ error: 'Could not load the Hyphen requests.' }, 500)
  }
})
