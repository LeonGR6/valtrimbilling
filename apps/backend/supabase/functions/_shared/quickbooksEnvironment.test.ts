import { assertEquals, assertThrows } from '@std/assert'
import { environmentOrNull, quickbooksClientCredentials } from './quickbooksEnvironment.ts'

const secrets = (values: Record<string, string>) => (name: string) => values[name]

Deno.test('each environment reads its own Intuit app keys', () => {
  const getEnv = secrets({
    QBO_SANDBOX_CLIENT_ID: 'sb-id',
    QBO_SANDBOX_CLIENT_SECRET: 'sb-secret',
    QBO_PRODUCTION_CLIENT_ID: 'pr-id',
    QBO_PRODUCTION_CLIENT_SECRET: 'pr-secret',
  })

  assertEquals(quickbooksClientCredentials('sandbox', getEnv), { clientId: 'sb-id', clientSecret: 'sb-secret' })
  assertEquals(quickbooksClientCredentials('production', getEnv), { clientId: 'pr-id', clientSecret: 'pr-secret' })
})

Deno.test('the older single set of keys keeps serving the environment it was set up for', () => {
  const legacySandbox = secrets({ QBO_CLIENT_ID: 'old-id', QBO_CLIENT_SECRET: 'old-secret', QBO_ENVIRONMENT: 'sandbox' })
  assertEquals(quickbooksClientCredentials('sandbox', legacySandbox), { clientId: 'old-id', clientSecret: 'old-secret' })

  // ...and are never used for the other one.
  assertThrows(() => quickbooksClientCredentials('production', legacySandbox), Error, 'QBO_PRODUCTION_CLIENT_ID')

  const legacyProduction = secrets({ QBO_CLIENT_ID: 'old-id', QBO_CLIENT_SECRET: 'old-secret', QBO_ENVIRONMENT: 'production' })
  assertEquals(quickbooksClientCredentials('production', legacyProduction).clientId, 'old-id')
  assertThrows(() => quickbooksClientCredentials('sandbox', legacyProduction), Error, 'QBO_SANDBOX_CLIENT_ID')
})

Deno.test('the new secrets win over the older ones, and a missing one is named', () => {
  const both = secrets({
    QBO_SANDBOX_CLIENT_ID: 'new-id',
    QBO_SANDBOX_CLIENT_SECRET: 'new-secret',
    QBO_CLIENT_ID: 'old-id',
    QBO_CLIENT_SECRET: 'old-secret',
  })
  assertEquals(quickbooksClientCredentials('sandbox', both).clientId, 'new-id')

  assertThrows(
    () => quickbooksClientCredentials('production', secrets({ QBO_PRODUCTION_CLIENT_ID: 'only-id' })),
    Error,
    'Missing Edge Function secret: QBO_PRODUCTION_CLIENT_SECRET.',
  )
})

Deno.test('only the two known environments are accepted', () => {
  assertEquals(environmentOrNull('sandbox'), 'sandbox')
  assertEquals(environmentOrNull('production'), 'production')
  assertEquals(environmentOrNull('staging'), null)
  assertEquals(environmentOrNull(null), null)
  assertEquals(environmentOrNull(undefined), null)
})
