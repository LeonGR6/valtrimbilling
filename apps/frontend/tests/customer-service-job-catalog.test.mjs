import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCustomerServiceBuilderOptions,
  customerServiceJobCoordinatesValue,
  findCustomerServiceJob,
  resolveCustomerServiceBuilder,
  resolveCustomerServiceJob,
} from '../src/features/customer-service/data/customerServiceJobCatalog.js'

const builders = [
  { id: 7, code: 'BR', name: 'Brookfield Residential', isActive: true },
  { id: 9, code: 'TPIE', name: 'Tri Pointe Homes Inland Empire', isActive: true },
  { id: 10, code: 'KBH', name: 'KB Home', isActive: true },
  { id: 99, code: 'OLD', name: 'Inactive Builder', isActive: false },
]

const jobs = [
  {
    id: 101,
    builderId: 7,
    code: 'BR-MAG',
    community: 'Magnolia at Arcadia',
    communityLatitude: 34.111521,
    communityLongitude: -118.00946,
    isActive: true,
  },
  {
    id: 102,
    builderId: 9,
    code: '1236',
    community: 'Linwood',
    communityLatitude: 33.94535,
    communityLongitude: -116.87612,
    isActive: true,
  },
  {
    id: 103,
    builderId: 10,
    code: 'KBH-OLD',
    community: 'Inactive Job',
    communityLatitude: 34,
    communityLongitude: -118,
    isActive: false,
  },
]

const builderOptions = buildCustomerServiceBuilderOptions(builders, jobs)

test('builds the Customer Service catalog only from active Supabase records', () => {
  assert.deepEqual(
    builderOptions.map((builder) => builder.value),
    ['Brookfield Residential', 'KB Home', 'Tri Pointe Homes Inland Empire'],
  )
  assert.equal(
    builderOptions.find((builder) => builder.value === 'KB Home').jobs.length,
    0,
  )
  assert.equal(
    builderOptions.some((builder) => builder.value === 'Inactive Builder'),
    false,
  )
})

test('Builder aliases ignore case, accents, punctuation and internal spacing', () => {
  const result = resolveCustomerServiceBuilder(
    '  TRI-POINTE   HOMES inland empire ',
    builderOptions,
  )

  assert.equal(result.status, 'MATCHED')
  assert.equal(result.match.value, 'Tri Pointe Homes Inland Empire')
})

test('Project / Job resolution stays inside the selected Builder and exposes coordinates', () => {
  const builder = resolveCustomerServiceBuilder('Brookfield', builderOptions).match
  const result = resolveCustomerServiceJob('BR-MAG', builder, builderOptions)

  assert.equal(result.status, 'MATCHED')
  assert.equal(result.match.id, '101')
  assert.equal(result.match.name, 'Magnolia at Arcadia')
  assert.equal(
    customerServiceJobCoordinatesValue(result.match),
    '34.111521, -118.00946',
  )
})

test('unknown and ambiguous aliases never select a catalog record', () => {
  assert.equal(
    resolveCustomerServiceBuilder('Unknown Builder', builderOptions).status,
    'NOT_FOUND',
  )
  const ambiguous = resolveCustomerServiceJob('Shared Job', null, [
    { value: 'Builder A', communities: ['Shared Job'] },
    { value: 'Builder B', communities: ['Shared Job'] },
  ])

  assert.equal(ambiguous.status, 'AMBIGUOUS')
  assert.equal(ambiguous.match, null)
})

test('saved requests recover their registered Job from id or canonical names', () => {
  const byId = findCustomerServiceJob({
    builderName: 'Tri Pointe Homes',
    jobId: 102,
  }, builderOptions)
  const byName = findCustomerServiceJob({
    builderName: 'Brookfield Residential',
    community: 'Magnolia at Arcadia',
  }, builderOptions)

  assert.equal(byId.id, '102')
  assert.equal(byName.id, '101')
})
