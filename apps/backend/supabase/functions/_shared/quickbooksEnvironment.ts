// QuickBooks has two environments in this platform: "sandbox" (shown as Test) and
// "production". Both can be connected at once. Which one NEW invoices go to is a
// setting only an administrator changes; everything done to an invoice that
// already exists (void, PDF, payments) uses the environment it was sent to.

import { parseQuickbooksEnvironment, type QuickbooksEnvironment } from './quickbooksApi.ts'
import { openQuickbooksSession, type QuickbooksSession, type RpcClient } from './quickbooksSession.ts'
import type { serviceClient } from './supabase.ts'

type Admin = ReturnType<typeof serviceClient>

export const ENVIRONMENT_LABELS: Record<QuickbooksEnvironment, string> = {
  sandbox: 'Test',
  production: 'Production',
}

type GetEnv = (name: string) => string | undefined

const readSecret: GetEnv = (name) => Deno.env.get(name)?.trim() || undefined

/**
 * The Intuit app keys of an environment: QBO_SANDBOX_CLIENT_ID / _SECRET and
 * QBO_PRODUCTION_CLIENT_ID / _SECRET. The older QBO_CLIENT_ID / _SECRET (with
 * QBO_ENVIRONMENT) keep working for the one environment they were set up for, so
 * nothing breaks before the new secrets are in place.
 */
export function quickbooksClientCredentials(
  environment: QuickbooksEnvironment,
  getEnv: GetEnv = readSecret,
) {
  const prefix = `QBO_${environment.toUpperCase()}`
  const legacyApplies = (getEnv('QBO_ENVIRONMENT') ?? 'sandbox') === environment

  const clientId = getEnv(`${prefix}_CLIENT_ID`) ?? (legacyApplies ? getEnv('QBO_CLIENT_ID') : undefined)
  const clientSecret = getEnv(`${prefix}_CLIENT_SECRET`)
    ?? (legacyApplies ? getEnv('QBO_CLIENT_SECRET') : undefined)

  if (!clientId) throw new Error(`Missing Edge Function secret: ${prefix}_CLIENT_ID.`)
  if (!clientSecret) throw new Error(`Missing Edge Function secret: ${prefix}_CLIENT_SECRET.`)
  return { clientId, clientSecret }
}

/** Where new invoices go. */
export async function loadActiveEnvironment(admin: Admin): Promise<QuickbooksEnvironment> {
  const { data, error } = await admin
    .from('quickbooks_settings')
    .select('active_environment')
    .eq('id', true)
    .maybeSingle()
  if (error) throw new Error(error.message)

  return parseQuickbooksEnvironment(data?.active_environment ?? 'sandbox')
}

export function openSessionFor(
  admin: RpcClient,
  environment: QuickbooksEnvironment,
): Promise<QuickbooksSession> {
  return openQuickbooksSession(admin, environment, quickbooksClientCredentials(environment))
}

/** The environment a stored value names, or null when it names none. */
export function environmentOrNull(value: string | null | undefined): QuickbooksEnvironment | null {
  return value === 'sandbox' || value === 'production' ? value : null
}
