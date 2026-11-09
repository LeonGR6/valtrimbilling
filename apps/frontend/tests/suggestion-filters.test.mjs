import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterSuggestions,
  suggestionBuilders,
  suggestionSubmissionMethods,
} from '../src/features/draw-invoice/utils/suggestionFilters.js'

const suggestions = [
  { job: { id: 1, code: '1307', builder: 'Olson Homes', community: 'Willow Creek' } },
  { job: { id: 2, code: '1295', builder: 'Indigo Builders', community: 'Palm Grove' } },
  { job: { id: 3, code: '1410', builder: 'Olson Homes', community: 'Cedar Park' } },
  { job: { id: 4, code: '1500', builder: '', community: null } },
]

test('the Builders are listed once, in order, without blanks', () => {
  assert.deepEqual(suggestionBuilders(suggestions), ['Indigo Builders', 'Olson Homes'])
  assert.deepEqual(suggestionBuilders(), [])
})

test('no filter keeps every suggestion', () => {
  assert.equal(filterSuggestions(suggestions).length, 4)
  assert.equal(filterSuggestions(suggestions, { builder: '', job: '  ' }).length, 4)
})

test('a Builder keeps only its Jobs', () => {
  assert.deepEqual(
    filterSuggestions(suggestions, { builder: 'Olson Homes' }).map(({ job }) => job.id),
    [1, 3],
  )
})

test('the Job text matches the code, with or without #, and the community', () => {
  assert.deepEqual(filterSuggestions(suggestions, { job: '#1295' }).map(({ job }) => job.id), [2])
  assert.deepEqual(filterSuggestions(suggestions, { job: '14' }).map(({ job }) => job.id), [3])
  assert.deepEqual(filterSuggestions(suggestions, { job: 'cedar' }).map(({ job }) => job.id), [3])
})

test('Builder and Job work together', () => {
  assert.deepEqual(
    filterSuggestions(suggestions, { builder: 'Olson Homes', job: 'willow' }).map(({ job }) => job.id),
    [1],
  )
  assert.deepEqual(filterSuggestions(suggestions, { builder: 'Indigo Builders', job: '1307' }), [])
})

test('a Builder that is not in the list filters nothing', () => {
  assert.equal(filterSuggestions(suggestions, { builder: 'Gone Homes' }).length, 4)
})

test('Submitted by lists the ways in the order of the Builder Setup and filters on one of them', () => {
  const bySubmission = [
    { job: { id: 1, code: '1307', builder: 'Olson Homes' }, submissionMethod: 'TEXTURA' },
    { job: { id: 2, code: '1295', builder: 'Indigo Builders' }, submissionMethod: 'PORTAL' },
    { job: { id: 3, code: '1410', builder: 'Olson Homes' }, submissionMethod: 'TEXTURA' },
    { job: { id: 4, code: '1500', builder: 'KB' }, submissionMethod: 'EMAIL' },
  ]
  assert.deepEqual(suggestionSubmissionMethods(bySubmission), ['PORTAL', 'EMAIL', 'TEXTURA'])
  assert.deepEqual(suggestionSubmissionMethods(suggestions), [])
  assert.deepEqual(
    filterSuggestions(bySubmission, { submission: 'TEXTURA' }).map(({ job }) => job.id),
    [1, 3],
  )
  assert.deepEqual(
    filterSuggestions(bySubmission, { submission: 'TEXTURA', builder: 'Olson Homes', job: '14' }).map(({ job }) => job.id),
    [3],
  )
  assert.equal(filterSuggestions(bySubmission, { submission: '' }).length, 4)
})
