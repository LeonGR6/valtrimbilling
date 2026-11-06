import assert from 'node:assert/strict'
import test from 'node:test'
import { savePdfToDisk, saveToDisk } from '../src/utils/downloadFile.js'

// The browser pieces the download uses, as small stand-ins.
function withBrowser(run) {
  const calls = { created: [], revoked: [], clicked: [] }
  const link = { click() { calls.clicked.push({ href: this.href, download: this.download }) } }
  const previous = {
    URL: globalThis.URL,
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
  }
  globalThis.URL = {
    createObjectURL(blob) {
      calls.created.push(blob)
      return 'blob:test'
    },
    revokeObjectURL(url) {
      calls.revoked.push(url)
    },
  }
  globalThis.document = { createElement: () => link }
  globalThis.setTimeout = (callback) => {
    callback()
    return 0
  }
  try {
    run(calls)
  } finally {
    Object.assign(globalThis, previous)
  }
}

test('a Blob is saved through a download link with the file name, and its address is released', () => {
  withBrowser((calls) => {
    const blob = new Blob(['x'])
    saveToDisk(blob, 'Package.pdf')

    assert.equal(calls.created[0], blob)
    assert.deepEqual(calls.clicked, [{ href: 'blob:test', download: 'Package.pdf' }])
    assert.deepEqual(calls.revoked, ['blob:test'])
  })
})

test('the bytes of a PDF are saved as a PDF file', () => {
  withBrowser((calls) => {
    savePdfToDisk(new Uint8Array([37, 80, 68, 70]), 'Release.pdf')

    assert.equal(calls.created[0].type, 'application/pdf')
    assert.equal(calls.created[0].size, 4)
    assert.deepEqual(calls.clicked, [{ href: 'blob:test', download: 'Release.pdf' }])
  })
})
