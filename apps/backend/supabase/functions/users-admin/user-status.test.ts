import { getAccountStatus } from './user-status.ts'

function assertEquals(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, received ${actual}.`)
  }
}

Deno.test('inactive status takes priority over Auth activity', () => {
  assertEquals(
    getAccountStatus(true, null, null),
    'PENDING_INVITE',
  )
  assertEquals(
    getAccountStatus(false, '2026-09-09T12:00:00Z', '2026-09-10T12:00:00Z'),
    'INACTIVE',
  )
})

Deno.test('confirmed accounts are separated by password sign-in activity', () => {
  assertEquals(
    getAccountStatus(true, '2026-09-09T12:00:00Z', null),
    'NEVER_SIGNED_IN',
  )
  assertEquals(
    getAccountStatus(true, '2026-09-09T12:00:00Z', '2026-09-10T12:00:00Z'),
    'ACTIVE',
  )
})
