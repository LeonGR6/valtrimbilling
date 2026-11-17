import assert from 'node:assert/strict'
import test from 'node:test'
import { getInitials } from '../src/utils/initials.js'

test('the initials are the first letters of the first two words, in capitals', () => {
  assert.equal(getInitials('Ana María López'), 'AM')
  assert.equal(getInitials('ana'), 'A')
  assert.equal(getInitials('  juan   pérez  '), 'JP')
  assert.equal(getInitials(''), '')
})
