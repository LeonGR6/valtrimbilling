import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCustomerServiceBuilderOptions } from '../src/features/customer-service/data/customerServiceJobCatalog.js'
import { searchCatalogOptions } from '../src/features/customer-service/utils/catalogSearch.js'

const builders = [
  { id: 7, code: 'BR', name: 'Brookfield Residential', isActive: true },
  { id: 9, code: 'TPIE', name: 'Tri Pointe Homes Inland Empire', isActive: true },
  { id: 10, code: 'KBH', name: 'KB Home', isActive: true },
  { id: 11, code: 'CV', name: 'City Ventures', isActive: true },
]
const jobs = [
  { id: 694, builderId: 10, code: 'KBH-RMA', community: 'Rancho Madrina', communityLatitude: 33.7,
    communityLongitude: -117, isActive: true, communityAliases: [{ id: 1, alias: 'KB Rancho Madrina' }] },
  { id: 695, builderId: 10, code: 'KBH-ARR', community: 'Arroyo', communityLatitude: 34, communityLongitude: -117,
    isActive: true },
  { id: 696, builderId: 10, code: 'KBH-SV', community: 'Sierra Vista Ranch', communityLatitude: 34,
    communityLongitude: -117, isActive: true },
  { id: 697, builderId: 10, code: 'KBH-RG', community: 'Rose Garden', communityLatitude: 34,
    communityLongitude: -117, isActive: true },
]
const builderOptions = buildCustomerServiceBuilderOptions(builders, jobs)
const kb = builderOptions.find((option) => option.value === 'KB Home')
const jobOptions = kb.jobs.map((job) => ({ value: job.id, label: job.label, aliases: job.aliases }))
const labels = (options) => options.map((option) => option.label)

test('an empty search keeps the whole catalog in its order', () => {
  assert.equal(searchCatalogOptions(builderOptions, '').length, builderOptions.length)
  assert.equal(searchCatalogOptions(builderOptions, '  - ').length, builderOptions.length)
})

test('Builders are found by code, name or a known name, ignoring case and punctuation', () => {
  assert.deepEqual(labels(searchCatalogOptions(builderOptions, 'kb homes')), ['KBH · KB Home'])
  assert.deepEqual(labels(searchCatalogOptions(builderOptions, 'TriPointe')), ['TPIE · Tri Pointe Homes Inland Empire'])
  assert.deepEqual(labels(searchCatalogOptions(builderOptions, 'brook')), ['BR · Brookfield Residential'])
  assert.deepEqual(labels(searchCatalogOptions(builderOptions, 'cv')), ['CV · City Ventures'])
  assert.deepEqual(searchCatalogOptions(builderOptions, 'lennar'), [])
})

test('Jobs are found by code, community or a name saved from an email', () => {
  assert.deepEqual(labels(searchCatalogOptions(jobOptions, 'kb rancho')), ['KBH-RMA · Rancho Madrina'])
  assert.deepEqual(labels(searchCatalogOptions(jobOptions, 'kbh-arr')), ['KBH-ARR · Arroyo'])
  assert.deepEqual(labels(searchCatalogOptions(jobOptions, 'vista')), ['KBH-SV · Sierra Vista Ranch'])
})

test('a word that starts with the search comes before a match inside a word', () => {
  assert.deepEqual(labels(searchCatalogOptions(jobOptions, 'ranch')), [
    'KBH-RMA · Rancho Madrina',
    'KBH-SV · Sierra Vista Ranch',
  ])
  // The catalog lists Arroyo first, but "Rose" starts with "ro" and "Arroyo" only holds it.
  assert.deepEqual(labels(jobOptions).slice(0, 2), ['KBH-ARR · Arroyo', 'KBH-RG · Rose Garden'])
  assert.deepEqual(labels(searchCatalogOptions(jobOptions, 'ro')), [
    'KBH-RG · Rose Garden',
    'KBH-ARR · Arroyo',
  ])
})
