import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PACKAGE_CATALOG_TABS,
  canDeleteDraftPackage,
  filterPackageCatalogContexts,
  packageCatalogBuilderOptions,
  packageCatalogCommunityOptions,
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
