import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterJobsByScope,
  jobBuilderOptions,
  jobCommunityOptions,
  resolveJobScope,
} from '../src/features/jobs/utils/jobScopeFilters.js'

const jobs = [
  { id: 1, code: '1501', builderId: 7, builder: 'Zed Homes', community: 'Lakes' },
  { id: 2, code: '1502', builderId: 7, builder: 'Zed Homes', community: 'Pines' },
  { id: 3, code: '1601', builderId: 9, builder: 'Acme', community: 'Lakes' },
]
const codes = (filters) => filterJobsByScope(jobs, filters).map(({ code }) => code)

test('Jobs filter by Builder, Community and text together', () => {
  assert.deepEqual(codes({}), ['1501', '1502', '1601'])
  assert.deepEqual(codes({ builderId: '7' }), ['1501', '1502'])
  assert.deepEqual(codes({ community: 'Lakes' }), ['1501', '1601'])
  assert.deepEqual(codes({ builderId: '9', community: 'Pines' }), [])
  assert.deepEqual(codes({ builderId: '7', search: '1502' }), ['1502'])
  assert.deepEqual(codes({ search: 'acme' }), ['1601'])
})

test('options are unique, sorted, and Communities follow the Builder', () => {
  assert.deepEqual(jobBuilderOptions(jobs), [
    { id: '9', name: 'Acme' },
    { id: '7', name: 'Zed Homes' },
  ])
  assert.deepEqual(jobCommunityOptions(jobs), ['Lakes', 'Pines'])
  assert.deepEqual(jobCommunityOptions(jobs, '9'), ['Lakes'])
})

test('a remembered scope that no longer exists falls back to All', () => {
  const stale = resolveJobScope(jobs, { builderId: '42', community: 'Pines' })
  assert.deepEqual([stale.builderId, stale.community], ['ALL', 'Pines'])

  const gone = resolveJobScope(jobs, { builderId: '9', community: 'Pines' })
  assert.deepEqual([gone.builderId, gone.community], ['9', 'ALL'])

  const valid = resolveJobScope(jobs, { builderId: '7', community: 'Pines' })
  assert.deepEqual([valid.builderId, valid.community], ['7', 'Pines'])
})
