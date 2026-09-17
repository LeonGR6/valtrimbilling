import {
  DRAW_PACKAGE_STATUSES,
  DRAW_PACKAGE_STATUS_LABELS,
  canCorrectDrawPackage,
} from '../services/drawInvoicePackageRecord.js'

export const PACKAGE_CATALOG_TABS = [
  { value: 'ALL', label: 'All' },
  ...DRAW_PACKAGE_STATUSES.map((value) => ({
    value,
    label: DRAW_PACKAGE_STATUS_LABELS[value],
  })),
]

export function canDeleteDraftPackage(record) {
  return record?.status === 'DRAFT' && canCorrectDrawPackage(record)
}

export function filterPackageCatalogContexts(contexts, {
  search = '',
  builderId = 'ALL',
  community = 'ALL',
  status = 'ALL',
} = {}) {
  const normalizedSearch = String(search).trim().toLowerCase()
  return contexts.filter(({ record, job, phase }) => {
    if (record.status === 'CANCELLED') return false
    if (status !== 'ALL' && record.status !== status) return false
    if (builderId !== 'ALL' && String(record.builderId) !== String(builderId)) {
      return false
    }
    if (community !== 'ALL' && job.community !== community) return false
    if (!normalizedSearch) return true

    return [
      record.packageNumber,
      record.invoiceNumber,
      job.code,
      job.builder,
      job.community,
      phase.name,
      phase.building,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch))
  })
}

export function summarizePackageCatalogStatuses(contexts) {
  const summary = Object.fromEntries(
    DRAW_PACKAGE_STATUSES.map((status) => [status, { count: 0, total: 0 }]),
  )
  for (const { record, summary: financials } of contexts) {
    const bucket = summary[record.status]
    if (!bucket) continue
    bucket.count += 1
    bucket.total += Math.round((Number(financials?.invoiceAmount) || 0) * 100)
  }
  for (const bucket of Object.values(summary)) {
    bucket.total /= 100
  }
  return summary
}

export function packageCatalogBuilderOptions(contexts) {
  return [...new Map(contexts.map(({ record, job }) => [
    String(record.builderId),
    { id: String(record.builderId), name: job.builder },
  ])).values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function packageCatalogCommunityOptions(contexts, builderId = 'ALL') {
  return [...new Set(contexts
    .filter(({ record }) => builderId === 'ALL'
      || String(record.builderId) === String(builderId))
    .map(({ job }) => job.community)
    .filter(Boolean))].sort((left, right) => left.localeCompare(right))
}
