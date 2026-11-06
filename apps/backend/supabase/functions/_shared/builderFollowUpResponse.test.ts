import { assertEquals, assertMatch } from '@std/assert'
import {
  buildBuilderFollowUpResponseLinks,
  createBuilderFollowUpResponseToken,
  verifyBuilderFollowUpResponseToken,
} from './builderFollowUpResponse.ts'

const publicId = '1fceaf58-9b68-4c2e-903f-9618ceaf1a82'
const secret = 'test-only-secret-with-more-than-32-bytes'

Deno.test('creates and verifies a signed opaque follow-up response token', async () => {
  const token = await createBuilderFollowUpResponseToken(publicId, secret)

  assertMatch(token, new RegExp(`^${publicId}\\.[A-Za-z0-9_-]{43}$`, 'u'))
  assertEquals(await verifyBuilderFollowUpResponseToken(token, secret), publicId)
})

Deno.test('rejects tampered or malformed follow-up response tokens', async () => {
  const token = await createBuilderFollowUpResponseToken(publicId, secret)
  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`

  assertEquals(await verifyBuilderFollowUpResponseToken(tampered, secret), null)
  assertEquals(await verifyBuilderFollowUpResponseToken('not-a-token', secret), null)
})

Deno.test('builds separate encoded links for both response intents', () => {
  const links = buildBuilderFollowUpResponseLinks(
    'https://billing.valtrim.com/',
    `${publicId}.signature_value`,
  )

  assertEquals(new URL(links.confirmed).searchParams.get('intent'), 'confirmed')
  assertEquals(new URL(links.notReady).searchParams.get('intent'), 'not-ready')
  assertEquals(
    new URL(links.confirmed).searchParams.get('token'),
    `${publicId}.signature_value`,
  )
})
