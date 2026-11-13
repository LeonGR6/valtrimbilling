import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadTemplateAndPdf } from '../src/features/release-templates/services/releaseTemplateLoader.js'

const document = { id: 'doc-1', name: 'release.pdf' }

function collaborators(overrides = {}) {
  const calls = []
  return {
    calls,
    options: {
      document,
      template: null,
      analyze: async (doc, options) => {
        calls.push(['analyze', doc.id, options])
        return { id: 'tpl-1', status: 'needs_review' }
      },
      download: async (doc) => {
        calls.push(['download', doc.id])
        return 'pdf-blob'
      },
      onStep: (step) => calls.push(['step', step]),
      ...overrides,
    },
  }
}

test('a document without a template is analyzed once, then its PDF is downloaded', async () => {
  const { calls, options } = collaborators()
  const result = await loadTemplateAndPdf(options)

  assert.deepEqual(result, { template: { id: 'tpl-1', status: 'needs_review' }, file: 'pdf-blob' })
  assert.deepEqual(calls, [
    ['analyze', 'doc-1', {}],
    ['step', 'loading-pdf'],
    ['download', 'doc-1'],
  ])
})

test('a template that already finished analysis is reused without analyzing again', async () => {
  for (const status of ['needs_review', 'confirmed', 'superseded']) {
    const { calls, options } = collaborators({ template: { id: 'existing', status } })
    const result = await loadTemplateAndPdf(options)

    assert.equal(result.template.id, 'existing', status)
    assert.deepEqual(calls.map(([name]) => name), ['step', 'download'], status)
  }
})

test('a failed or still-running template is analyzed again', async () => {
  for (const status of ['failed', 'analyzing']) {
    const { calls, options } = collaborators({ template: { id: 'old', status } })
    const result = await loadTemplateAndPdf(options)

    assert.equal(result.template.id, 'tpl-1', status)
    assert.equal(calls[0][0], 'analyze', status)
  }
})

test('an analysis error stops the load before the PDF is requested', async () => {
  const { calls, options } = collaborators({
    analyze: async () => { throw new Error('This Release is already being analyzed.') },
  })

  await assert.rejects(() => loadTemplateAndPdf(options), /already being analyzed/)
  assert.deepEqual(calls, [])
})

test('a download error is surfaced to the caller', async () => {
  const { options } = collaborators({
    template: { id: 'existing', status: 'confirmed' },
    download: async () => { throw new Error('The PDF could not be opened.') },
  })
  await assert.rejects(() => loadTemplateAndPdf(options), /could not be opened/)
})

// Regression guard. react-pdf 11 suspends by default; inside the review dialog
// that hid the whole dialog and re-ran its loading effect over and over, so the
// view flashed on and off and analyzed the PDF repeatedly.
test('the PDF viewer keeps react-pdf out of Suspense mode', () => {
  const source = readFileSync(
    new URL('../src/features/release-templates/components/ReleasePdfPages.jsx', import.meta.url),
    'utf8',
  )

  for (const component of ['Document', 'Page']) {
    const tag = source.match(new RegExp(`<${component}\\b[\\s\\S]*?>`))?.[0] ?? ''
    assert.match(tag, /suspense=\{false\}/, `<${component}> must set suspense={false}`)
  }
})
