import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ensurePasswordFlowUser,
  establishPasswordFlow,
  parsePasswordFlowUrl,
} from '../src/features/auth/reset-password/services/passwordFlow.js'

const accessToken = 'invite-access-token'
const refreshToken = 'invite-refresh-token'

function inviteLink(overrides = {}) {
  return {
    expectedType: 'invite',
    type: 'invite',
    accessToken,
    refreshToken,
    errorCode: null,
    errorDescription: null,
    ...overrides,
  }
}

test('password URLs distinguish invitations from recovery', () => {
  const invite = parsePasswordFlowUrl(
    `http://localhost:5173/accept-invite#access_token=${accessToken}&refresh_token=${refreshToken}&type=invite`,
  )
  const recovery = parsePasswordFlowUrl(
    `http://localhost:5173/reset-password#access_token=${accessToken}&refresh_token=${refreshToken}&type=recovery`,
  )

  assert.equal(invite.expectedType, 'invite')
  assert.equal(invite.type, 'invite')
  assert.equal(recovery.expectedType, 'recovery')
  assert.equal(recovery.type, 'recovery')
})

test('an invitation explicitly establishes and verifies the linked user', async () => {
  const linkedUser = { id: 'invited-user', email: 'invited@example.com' }
  const client = {
    auth: {
      async setSession(credentials) {
        assert.deepEqual(credentials, {
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        return {
          data: {
            session: { access_token: accessToken, user: linkedUser },
          },
          error: null,
        }
      },
      async getUser(token) {
        assert.equal(token, accessToken)
        return { data: { user: linkedUser }, error: null }
      },
    },
  }

  assert.deepEqual(await establishPasswordFlow(client, inviteLink()), {
    type: 'invite',
    userId: linkedUser.id,
    email: linkedUser.email,
  })
})

test('an invalid or mismatched link cannot use an existing session', async () => {
  const existingUser = { id: 'already-signed-in-user' }

  await assert.rejects(
    establishPasswordFlow({}, inviteLink({
      errorCode: 'otp_expired',
      errorDescription: 'Email link is invalid or has expired',
    })),
    /invalid or has expired/i,
  )
  assert.throws(
    () => ensurePasswordFlowUser(existingUser, 'invited-user'),
    /does not match/i,
  )
})

test('a recovery link cannot be used on the invitation route', async () => {
  await assert.rejects(
    establishPasswordFlow({}, inviteLink({ type: 'recovery' })),
    /does not match/i,
  )
})
