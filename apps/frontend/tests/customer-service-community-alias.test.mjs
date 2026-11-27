import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCustomerServiceBuilderOptions,
  findCustomerServiceJob,
  resolveCustomerServiceJob,
} from '../src/features/customer-service/data/customerServiceJobCatalog.js'
import {
  communityAliasOffer,
  extractedSourceProperty,
  isGenericCommunityName,
} from '../src/features/customer-service/utils/communityAliasOffer.js'

const builders = [
  { id: 10, code: 'KBH', name: 'KB Home', isActive: true },
  { id: 7, code: 'BR', name: 'Brookfield Residential', isActive: true },
]
const jobs = [
  {
    id: 694, builderId: 10, code: 'KB-RM', community: 'Rancho Madrina',
    communityLatitude: 33.7, communityLongitude: -117.1, isActive: true,
    communityAliases: [{ id: 1, alias: 'Rancho Madrina Phase 2' }],
  },
  {
    id: 695, builderId: 10, code: 'KB-AR', community: 'Arroyo',
    communityLatitude: 34.1, communityLongitude: -117.2, isActive: true,
    communityAliases: [{ id: 2, alias: 'KB Arroyo Village' }],
  },
  {
    id: 101, builderId: 7, code: 'BR-MAG', community: 'Magnolia Townhomes',
    communityLatitude: 34.11, communityLongitude: -118, isActive: true,
  },
]
const options = buildCustomerServiceBuilderOptions(builders, jobs)
const kb = options.find((option) => option.value === 'KB Home')
const rancho = kb.jobs.find((job) => job.id === '694')
const brookfield = options.find((option) => option.value === 'Brookfield Residential')
const magnolia = brookfield.jobs.find((job) => job.id === '101')
const offerFor = (extractedName, job = rancho, builderOption = kb, sourceBuilderName = '') =>
  communityAliasOffer({ extractedName, sourceBuilderName, builderOption, builderOptions: options, job })

test('a saved name links a later email to its Job, ignoring case and punctuation', () => {
  assert.equal(resolveCustomerServiceJob('rancho-madrina  PHASE 2', kb, options).match?.id, '694')
  assert.equal(findCustomerServiceJob({ builderName: 'KB Homes', community: 'KB Arroyo Village' }, options)?.id, '695')
  // A name saved for a KB Job does not link another Builder's email.
  assert.equal(resolveCustomerServiceJob('KB Arroyo Village', options.find((option) => option.value !== 'KB Home'), options).match, null)
})

test('the review offers to remember the name the source used for the chosen Job', () => {
  // Like CS-3572: the email said "KB Rancho Madrina", the Job is "Rancho Madrina".
  assert.deepEqual(offerFor('  KB   Rancho Madrina '), { status: 'OFFER', name: 'KB Rancho Madrina', key: 'kb rancho madrina' })
  assert.deepEqual(offerFor('4S Ranch').status, 'OFFER', 'a community may start with a number and a letter')
})

test('nothing is offered without a name or Job, or for a name the Job already has', () => {
  assert.equal(offerFor(''), null)
  assert.equal(offerFor('KB Rancho Madrina', null), null)
  assert.equal(offerFor('KB Rancho Madrina', rancho, null), null)
  assert.equal(offerFor('RANCHO MADRINA'), null, 'its community')
  assert.equal(offerFor('kb-rm'), null, 'its code')
  assert.equal(offerFor('Rancho Madrina, Phase 2'), null, 'a name saved before')
  assert.equal(offerFor('x'.repeat(121)), null, 'longer than the database keeps')
})

test('a name another Job of the Builder already has cannot be remembered', () => {
  const offer = offerFor('KB Arroyo Village')
  assert.equal(offer.status, 'TAKEN')
  assert.deepEqual(offer.otherJobs.map((job) => job.id), ['695'])
  assert.equal(offerFor('Arroyo').status, 'TAKEN')
})

test('generic names, addresses and the Builder name are never offered', () => {
  for (const name of ['Phase 4', 'N/A', 'Lot 12', 'Lot 12 Phase 2', 'TBD', 'Ph4', '1236',
    '1520 Rancho Madrina Way', 'Rancho Madrina 92584', 'KB Homes', 'KB Home', 'The Community']) {
    assert.equal(offerFor(name), null, name)
  }
  assert.equal(isGenericCommunityName('kb rancho madrina', kb), false)
  assert.equal(isGenericCommunityName('rancho madrina 2', kb), false, 'a phase number after a name is fine')
})

test('the name is offered only for the Builder the source named, or when it named none', () => {
  // Like CS-3572: the email names KB Home and "KB Rancho Madrina".
  assert.equal(offerFor('KB Rancho Madrina', rancho, kb, 'KB Home').status, 'OFFER')
  assert.equal(offerFor('KB Rancho Madrina', rancho, kb, 'KB Homes').status, 'OFFER', 'a known Builder name')
  assert.equal(offerFor('KB Rancho Madrina', rancho, kb, '').status, 'OFFER', 'the source named no Builder')
  // The coordinator picked a Brookfield Job: KB's name is never offered for it.
  assert.equal(offerFor('KB Rancho Madrina', magnolia, brookfield, 'KB Home'), null)
  // A Builder the catalog does not know cannot be confirmed.
  assert.equal(offerFor('KB Rancho Madrina', rancho, kb, 'Lennar'), null)
})

test('the community and Builder come from the import (email and PDF combined) before the analyzed source', () => {
  const extraction = { structuredData: {
    property: { communityName: ' Magnolia at Arcadia Phase 4 ', builderName: null },
    document: { issuerName: 'Brookfield Residential' },
  } }
  assert.deepEqual(
    extractedSourceProperty({ imported: { communityName: 'KB Rancho Madrina', builderName: 'KB Home' }, extraction }),
    { communityName: 'KB Rancho Madrina', builderName: 'KB Home' },
  )
  assert.deepEqual(
    extractedSourceProperty({ imported: { communityName: '', builderName: '' }, extraction }),
    { communityName: 'Magnolia at Arcadia Phase 4', builderName: 'Brookfield Residential' },
    'without an imported community, both come from the analyzed source; the issuer stands in for the Builder',
  )
  assert.deepEqual(extractedSourceProperty({ extraction: { structuredData: { property: { jobId: 4 } } } }),
    { communityName: '', builderName: '' })
  assert.deepEqual(extractedSourceProperty(), { communityName: '', builderName: '' })
})
