// The browser preflights any cross-origin request that carries an
// Authorization header, so every function the app calls has to answer OPTIONS
// before it ever sees the real request.
//
// The origin is wide open while there is no deployed frontend to name. Once
// the app has a domain, set ALLOWED_ORIGIN as a function secret and this
// narrows on its own:
//   npm run secrets:set --workspace=@valtrimbilling/backend ALLOWED_ORIGIN=https://...

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '*'

export const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response('ok', { headers: corsHeaders })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
