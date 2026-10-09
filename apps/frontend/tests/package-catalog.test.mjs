import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PACKAGE_CATALOG_TABS,
  canDeleteDraftPackage,
  filterPackageCatalogContexts,
  packageCatalogBuilderOptions,
  packageCatalogCommunityOptions,
  isValidPackageSort,
  nextPackageSort,
  sortPackageCatalogContexts,
  summarizePackageCatalogStatuses,
} from '../src/features/draw-invoice/utils/packageCatalog.js'

const contexts = [
  {
    record: { id: 1, builderId: 11, status: 'DRAFT', packageNumber: 'DP-1' },
    job: { code: '1306', builder: 'Acme', community: 'Deerfield' },
    phase: { name: 'Phase 1', building: 'P1' },
    summary: { invoiceAmount: 100.25 },
  },
  {
    record: { id: 2, builderId: 11, status: 'READY_TO_SUBMIT', packageNumber: 'DP-2' },
    job: { code: '1307', builder: 'Acme', community: 'Brookside' },
    phase: { name: 'Phase 2', building: 'P2' },
    summary: { invoiceAmount: 50.5 },
  },
  {
    record: { id: 3, builderId: 22, status: 'AWAITING_PAYMENT', packageNumber: 'DP-3' },
    job: { code: '1308', builder: 'Beta', community: 'Deerfield' },
    phase: { name: 'Phase 1', building: 'P1' },
    summary: { invoiceAmount: 25.1 },
  },
  {
    record: { id: 4, builderId: 22, status: 'PAID_CLOSED', packageNumber: 'DP-4' },
    job: { code: '1309', builder: 'Beta', community: 'Deerfield' },
    phase: { name: 'Phase 1', building: 'P1' },
    summary: { invoiceAmount: 10.3 },
  },
  {
    record: { id: 5, builderId: 11, status: 'CANCELLED', packageNumber: 'DP-5' },
    job: { code: '1310', builder: 'Acme', community: 'Deerfield' },
    phase: { name: 'Phase 1', building: 'P1' },
    summary: { invoiceAmount: 999 },
  },
]

test('catalog tabs use only the Package statuses actually persisted by the workflow', () => {
  assert.deepEqual(PACKAGE_CATALOG_TABS.map(({ value }) => value), [
    'ALL', 'DRAFT', 'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED',
  ])
})

test('cancelled Packages stay out of the catalog and all status totals', () => {
  const active = filterPackageCatalogContexts(contexts)
  assert.deepEqual(active.map(({ record }) => record.id), [1, 2, 3, 4])
  assert.deepEqual(summarizePackageCatalogStatuses(active), {
    DRAFT: { count: 1, total: 100.25 },
    READY_TO_SUBMIT: { count: 1, total: 50.5 },
    AWAITING_PAYMENT: { count: 1, total: 25.1 },
    PAID_CLOSED: { count: 1, total: 10.3 },
  })
})

test('Builder, Community, search and status filters compose without mixing names', () => {
  assert.deepEqual(filterPackageCatalogContexts(contexts, {
    builderId: '11', community: 'Deerfield', status: 'DRAFT', search: '1306',
  }).map(({ record }) => record.id), [1])
  assert.deepEqual(filterPackageCatalogContexts(contexts, {
    builderId: '11', community: 'Deerfield', status: 'AWAITING_PAYMENT',
  }), [])
  assert.deepEqual(filterPackageCatalogContexts(contexts, {
    community: 'Deerfield',
  }).map(({ record }) => record.id), [1, 3, 4])
})

test('Builder and Community options come from active Packages and Builder limits Community', () => {
  const active = filterPackageCatalogContexts(contexts)
  assert.deepEqual(packageCatalogBuilderOptions(active), [
    { id: '11', name: 'Acme' }, { id: '22', name: 'Beta' },
  ])
  assert.deepEqual(packageCatalogCommunityOptions(active, '11'), [
    'Brookside', 'Deerfield',
  ])
})

test('Delete is offered only for a correctable Draft, never cancelled or ready', () => {
  const draft = {
    status: 'DRAFT',
    persistedInvoice: { status: 'DRAFT', paidAmount: 0 },
    invoiceNumber: null,
    invoiceDate: null,
    quickbooksStatus: 'NOT_CREATED',
    submissionStatus: 'NOT_SUBMITTED',
  }
  assert.equal(canDeleteDraftPackage(draft), true)
  assert.equal(canDeleteDraftPackage({ ...draft, status: 'READY_TO_SUBMIT' }), false)
  assert.equal(canDeleteDraftPackage({ ...draft, status: 'CANCELLED' }), false)
  assert.equal(canDeleteDraftPackage({ ...draft, invoiceNumber: 'INV-1' }), false)
})

test('an unissued Retention Release Draft can be cancelled but not edited', () => {
  const release = {
    packageType: 'RETENTION_RELEASE',
    status: 'DRAFT',
    persistedInvoice: { status: 'DRAFT', paidAmount: 0 },
    invoiceNumber: null,
    invoiceDate: null,
    quickbooksStatus: 'NOT_CREATED',
    quickbooksReference: null,
    submissionStatus: 'NOT_SUBMITTED',
    submittedAt: null,
  }

  assert.equal(canDeleteDraftPackage(release), true)
})

const sortable = [
  { record: { id: 1, createdAt: '2026-10-01T10:00:00Z' }, job: { builder: 'beta', community: 'Pines' }, summary: { invoiceAmount: 300 } },
  { record: { id: 2, createdAt: '2026-10-03T10:00:00Z' }, job: { builder: 'Acme', community: 'Lakes' }, summary: { invoiceAmount: 100 } },
  { record: { id: 3, createdAt: '2026-10-02T10:00:00Z' }, job: { builder: 'Acme', community: 'Brook' }, summary: { invoiceAmount: 100 } },
]
const sortedIds = (sort) => sortPackageCatalogContexts(sortable, sort).map(({ record }) => record.id)

test('Packages sort by created date in both directions', () => {
  assert.deepEqual(sortedIds({ key: 'created', direction: 'desc' }), [2, 3, 1])
  assert.deepEqual(sortedIds({ key: 'created', direction: 'asc' }), [1, 3, 2])
})

test('Packages sort by Builder A to Z, then Community, and back', () => {
  assert.deepEqual(sortedIds({ key: 'builder', direction: 'asc' }), [3, 2, 1])
  assert.deepEqual(sortedIds({ key: 'builder', direction: 'desc' }), [1, 2, 3])
})

test('Packages sort by Invoice Amount and break ties by newest Package number', () => {
  assert.deepEqual(sortedIds({ key: 'invoice', direction: 'asc' }), [3, 2, 1])
  assert.deepEqual(sortedIds({ key: 'invoice', direction: 'desc' }), [1, 3, 2])
})

test('without a sort the Packages keep their order and the input is never mutated', () => {
  assert.deepEqual(sortedIds(null), [1, 2, 3])
  sortPackageCatalogContexts(sortable, { key: 'invoice', direction: 'desc' })
  assert.deepEqual(sortable.map(({ record }) => record.id), [1, 2, 3])
})

test('a column header cycles first direction, opposite direction, then no sort', () => {
  const first = nextPackageSort(null, 'created')
  assert.deepEqual(first, { key: 'created', direction: 'desc' })
  const second = nextPackageSort(first, 'created')
  assert.deepEqual(second, { key: 'created', direction: 'asc' })
  assert.equal(nextPackageSort(second, 'created'), null)
  assert.deepEqual(nextPackageSort(second, 'builder'), { key: 'builder', direction: 'asc' })
  assert.deepEqual(nextPackageSort(null, 'invoice'), { key: 'invoice', direction: 'asc' })
})

test('only known sorts are accepted from storage', () => {
  assert.equal(isValidPackageSort(null), true)
  assert.equal(isValidPackageSort({ key: 'builder', direction: 'desc' }), true)
  assert.equal(isValidPackageSort({ key: 'status', direction: 'asc' }), false)
  assert.equal(isValidPackageSort({ key: 'builder', direction: 'up' }), false)
  assert.equal(isValidPackageSort('builder'), false)
})
