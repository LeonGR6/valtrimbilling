import assert from 'node:assert/strict'
import test from 'node:test'
import { functionErrorMessage } from '../src/services/functionErrors.js'

const failedResponse = (body) => ({ context: { clone: () => ({ json: async () => body }) } })

test('the message the function sent in its answer comes first', async () => {
  assert.equal(await functionErrorMessage(new Error('boom'), { error: 'Sent by the function' }, 'fallback'), 'Sent by the function')
})

test('then the message in the body of the error response', async () => {
  assert.equal(
    await functionErrorMessage({ ...failedResponse({ error: 'From the response body' }), message: 'boom' }, null, 'fallback'),
    'From the response body',
  )
})

test('then the error\'s own message, and the fallback when there is none', async () => {
  assert.equal(await functionErrorMessage(new Error('boom'), null, 'fallback'), 'boom')
  // A body that is not JSON, or has no message, does not hide the error's own.
  const unreadable = { context: { clone: () => ({ json: async () => { throw new Error('not json') } }) }, message: 'boom' }
  assert.equal(await functionErrorMessage(unreadable, null, 'fallback'), 'boom')
  assert.equal(await functionErrorMessage({ ...failedResponse({}), message: '' }, null, 'fallback'), 'fallback')
  assert.equal(await functionErrorMessage(null, null, 'fallback'), 'fallback')
})
