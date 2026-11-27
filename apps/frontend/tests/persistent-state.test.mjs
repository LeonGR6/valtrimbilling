import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readStoredValue,
  writeStoredValue,
} from '../src/hooks/usePersistentState.js'

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    data,
  }
}

test('a written filter is read back after a refresh', () => {
  const storage = fakeStorage()
  writeStoredValue('docs:builder', '7', storage)

  assert.equal(storage.data.get('valtrim:docs:builder'), '"7"')
  assert.equal(readStoredValue('docs:builder', 'ALL', undefined, storage), '7')
})

test('missing, corrupt or invalid stored values fall back to the default', () => {
  const isTab = (value) => value === 'packages' || value === 'documents'

  assert.equal(readStoredValue('tab', 'packages', isTab, fakeStorage()), 'packages')
  assert.equal(
    readStoredValue('tab', 'packages', isTab, fakeStorage({ 'valtrim:tab': '{oops' })),
    'packages',
  )
  assert.equal(
    readStoredValue('tab', 'packages', isTab, fakeStorage({ 'valtrim:tab': '"reports"' })),
    'packages',
  )
  assert.equal(
    readStoredValue('tab', 'packages', isTab, fakeStorage({ 'valtrim:tab': '"documents"' })),
    'documents',
  )
})

test('a blocked or throwing storage never breaks the page', () => {
  const blocked = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
  }

  assert.equal(readStoredValue('tab', 'packages', undefined, blocked), 'packages')
  assert.doesNotThrow(() => writeStoredValue('tab', 'documents', blocked))
  assert.equal(readStoredValue('tab', 'packages', undefined, null), 'packages')
})
