import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  isSupabaseConfigured,
  requireSupabase,
} from '../../../services/api.js'
import { AuthContext } from './authContext.js'

async function fetchProfile(client, userId) {
  const { data, error } = await client
    .from('app_users')
    .select('id, name, email, phone, role, all_projects, is_active, last_login_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    throw new Error('Your account does not have a ValtrimBilling profile.')
  }

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    phone: data.phone ?? '',
    role: data.role,
    allProjects: data.all_projects,
    isActive: data.is_active,
    lastLoginAt: data.last_login_at,
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState(
    isSupabaseConfigured
      ? null
      : 'Supabase environment variables are missing.',
  )

  const loadProfile = useCallback(async (userId) => {
    const client = await requireSupabase()

    try {
      const nextProfile = await fetchProfile(client, userId)

      if (!nextProfile.isActive) {
        await client.auth.signOut()
        setProfile(null)
        throw new Error('Your account is inactive. Contact an administrator.')
      }

      setProfile(nextProfile)
      setError(null)
      return nextProfile
    } catch (profileError) {
      setProfile(null)
      setError(profileError.message)
      throw profileError
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined

    let mounted = true
    let subscription

    requireSupabase()
      .then((client) => {
        if (!mounted) return

        client.auth.getSession().then(({ data, error: sessionError }) => {
          if (!mounted) return
          setSession(data.session ?? null)
          setError(sessionError?.message ?? null)
          setSessionLoading(false)
        })

        const authListener = client.auth.onAuthStateChange((_event, nextSession) => {
          if (!mounted) return
          setSession(nextSession)
          if (!nextSession) {
            setProfile(null)
          }
        })
        subscription = authListener.data.subscription
      })
      .catch((clientError) => {
        if (!mounted) return
        setError(clientError.message)
        setSessionLoading(false)
      })

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user?.id) return undefined

    // The Auth session is an external source; its user id determines which
    // application profile must be synchronized into this provider.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile(session.user.id).catch(() => {})
    return undefined
  }, [loadProfile, session?.user?.id])

  const signIn = useCallback(async ({ email, password }) => {
    const client = await requireSupabase()
    setError(null)

    const { data, error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) throw signInError

    try {
      await loadProfile(data.user.id)
    } catch (profileError) {
      await client.auth.signOut()
      setSession(null)
      setProfile(null)
      throw profileError
    }

    return data
  }, [loadProfile])

  const signOut = useCallback(async () => {
    const client = await requireSupabase()
    const { error: signOutError } = await client.auth.signOut()
    if (signOutError) throw signOutError
    setSession(null)
    setProfile(null)
    setError(null)
  }, [])

  const requestPasswordReset = useCallback(async (email) => {
    const client = await requireSupabase()
    const redirectTo = `${window.location.origin}/reset-password`
    const { error: resetError } = await client.auth.resetPasswordForEmail(email, {
      redirectTo,
    })
    if (resetError) throw resetError
  }, [])

  const updatePassword = useCallback(async (password) => {
    const client = await requireSupabase()
    const { error: updateError } = await client.auth.updateUser({ password })
    if (updateError) throw updateError
    await client.auth.signOut()
    setSession(null)
    setProfile(null)
  }, [])

  const value = useMemo(() => ({
    configured: isSupabaseConfigured,
    session,
    user: session?.user ?? null,
    profile,
    loading: sessionLoading || Boolean(
      session
      && profile?.id !== session.user.id
      && !error,
    ),
    error,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    refreshProfile: () => session?.user?.id
      ? loadProfile(session.user.id)
      : Promise.resolve(null),
  }), [
    error,
    loadProfile,
    profile,
    requestPasswordReset,
    session,
    sessionLoading,
    signIn,
    signOut,
    updatePassword,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
