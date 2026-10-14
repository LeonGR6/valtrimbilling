import { useEffect, useState } from 'react'

const KEY_PREFIX = 'valtrim:'

function getStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Storage can be blocked (private mode, strict browser settings).
    return null
  }
}

export function readStoredValue(key, fallback, isValid = () => true, storage = getStorage()) {
  try {
    const raw = storage?.getItem(KEY_PREFIX + key)
    if (raw == null) return fallback
    const value = JSON.parse(raw)
    return isValid(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function writeStoredValue(key, value, storage = getStorage()) {
  try {
    storage?.setItem(KEY_PREFIX + key, JSON.stringify(value))
  } catch {
    // A full or blocked storage only means the value is not remembered.
  }
}

/**
 * useState that survives a page refresh. The value is read once on mount and
 * written back whenever it changes; a stored value that fails `isValid` (for
 * example one saved by an older version) is ignored.
 */
export function usePersistentState(key, initialValue, isValid) {
  const [value, setValue] = useState(
    () => readStoredValue(key, initialValue, isValid),
  )

  useEffect(() => {
    writeStoredValue(key, value)
  }, [key, value])

  return [value, setValue]
}

const isString = (value) => typeof value === 'string'

export const isStoredString = isString
