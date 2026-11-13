import assert from 'node:assert/strict'
import test from 'node:test'
import { plural } from '../src/utils/plural.js'

test('the count goes with the singular for one and with the plural for anything else', () => {
  assert.equal(plural(1, 'option'), '1 option')
  assert.equal(plural(0, 'option'), '0 options')
  assert.equal(plural(2, 'option'), '2 options')
  assert.equal(plural(1, 'new option', 'new options'), '1 new option')
  assert.equal(plural(3, 'phase', 'phases'), '3 phases')
  // Words that do not just add an "s" give their plural.
  assert.equal(plural(2, 'copy', 'copies'), '2 copies')
})
