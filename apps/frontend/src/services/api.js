const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && publishableKey)

let clientPromise = null

export async function requireSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and '
      + 'VITE_SUPABASE_PUBLISHABLE_KEY to apps/frontend/.env.',
    )
  }

  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => (
    createClient(url, publishableKey, {
      db: { schema: 'valtrim' },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  ))

  return clientPromise
}
