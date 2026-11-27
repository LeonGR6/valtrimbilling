import assert from 'node:assert/strict'
import test from 'node:test'

import { jobChoiceLabel, jobsOfBuilder } from '../src/features/change-orders/utils/jobChoices.js'

const jobs = [
  { id: 1, code: '1247', community: 'Rancho Madrina', builderId: 7 },
  { id: 2, code: '1295', community: 'Indigo', builderId: 7 },
  { id: 3, code: '1301', community: 'Corona', builderId: 9 },
]

test('a Builder offers all of its Jobs, whatever their Community, in the order they come', () => {
  assert.deepEqual(jobsOfBuilder(jobs, 7).map((job) => job.id), [1, 2])
  assert.deepEqual(jobsOfBuilder(jobs, 9).map((job) => job.id), [3])
})

test('the Builder id may be a string, as a select gives it', () => {
  assert.deepEqual(jobsOfBuilder(jobs, '7').map((job) => job.id), [1, 2])
})

test('without a Builder, or with one that has no Jobs, there is nothing to choose', () => {
  assert.deepEqual(jobsOfBuilder(jobs, ''), [])
  assert.deepEqual(jobsOfBuilder(jobs, null), [])
  assert.deepEqual(jobsOfBuilder(jobs, 99), [])
})

test('a Job reads as its number and its Community', () => {
  assert.equal(jobChoiceLabel(jobs[0]), '#1247 · Rancho Madrina')
  assert.equal(jobChoiceLabel({ code: '1400', community: '' }), '#1400')
})
