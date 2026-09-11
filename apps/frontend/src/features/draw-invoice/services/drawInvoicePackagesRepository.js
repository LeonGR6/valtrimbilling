import { requireSupabase } from '../../../services/api.js'
import {
  toCreateDrawPackageRpc,
  toDrawInvoicePackage,
  toPackageStatusRpc,
} from './drawInvoicePackageRecord.js'

const PACKAGE_COLUMNS = [
  'id',
  'package_number',
  'builder_id',
  'job_id',
  'phase_id',
  'setup_version_id',
  'package_date',
  'billing_period_start',
  'billing_period_end',
  'payment_terms_days',
  'invoice_line_format',
  'portal_name',
  'workflow_status',
  'notes',
  'created_at',
  'updated_at',
  'status_changed_at',
  'status_changed_by',
].join(', ')

const INVOICE_COLUMNS = [
  'id',
  'package_id',
  'invoice_number',
  'invoice_date',
  'due_date',
  'gross_amount',
  'retention_amount',
  'wrap_amount',
  'net_amount',
  'paid_amount',
  'status',
].join(', ')

const DRAW_COLUMNS = [
  'package_id',
  'lot_id',
  'draw_id',
  'lot_number',
  'plan_code',
  'draw_number',
  'draw_name',
  'base_draw_amount',
  'hardware_amount',
  'options_amount',
  'gross_amount',
  'retention_amount',
  'wrap_amount',
  'net_amount',
].join(', ')

const OPTION_COLUMNS = [
  'package_id',
  'lot_id',
  'option_id',
  'draw_id',
  'option_code',
  'option_name',
  'option_price',
].join(', ')

const SETUP_COLUMNS = [
  'id',
  'options_billing_draw_number',
].join(', ')

const PAGE_SIZE = 1000
const FILTER_BATCH_SIZE = 200

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Draw & Invoice Packages.', {
      cause: error,
    })
  }

  if (error.code === '23505') {
    throw new Error('One or more selected Lot / Draw combinations are already packaged.', {
      cause: error,
    })
  }

  if (error.code === '23503' || error.code === 'P0002') {
    throw new Error('A selected Package, Phase, Lot, Draw or Billing Setup is no longer available.', {
      cause: error,
    })
  }

  if (['23514', '22003', '22023', '22P02'].includes(error.code)) {
    throw new Error(error.message || 'Review the Package selections and status.', {
      cause: error,
    })
  }

  if (error.message?.includes('precio vigente')) {
    throw new Error('Every selected Plan and Option needs a current price.', {
      cause: error,
    })
  }

  throw new Error(error.message || 'The Draw & Invoice Packages request failed.', {
    cause: error,
  })
}

function inBatches(values) {
  const batches = []
  for (let index = 0; index < values.length; index += FILTER_BATCH_SIZE) {
    batches.push(values.slice(index, index + FILTER_BATCH_SIZE))
  }
  return batches
}

async function listAllRows(queryFactory) {
  const rows = []
  let start = 0

  while (true) {
    const { data, error } = await queryFactory().range(
      start,
      start + PAGE_SIZE - 1,
    )
    throwRepositoryError(error)

    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
    start += PAGE_SIZE
  }
}

function groupByPackage(rows) {
  return rows.reduce((grouped, row) => {
    const items = grouped.get(row.package_id) ?? []
    items.push(row)
    grouped.set(row.package_id, items)
    return grouped
  }, new Map())
}

async function listRowsInBatches(client, packageIds, table, columns, order) {
  const batchRows = await Promise.all(inBatches(packageIds).map((batch) =>
    listAllRows(() => {
      let query = client.from(table).select(columns).in('package_id', batch)
      for (const [column, ascending] of order) {
        query = query.order(column, { ascending })
      }
      return query
    }),
  ))

  return batchRows.flat()
}

export async function listDrawInvoicePackages() {
  const client = await requireSupabase()
  const packages = await listAllRows(() => client
    .from('draw_packages')
    .select(PACKAGE_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false }))

  if (packages.length === 0) return []

  const packageIds = packages.map(({ id }) => id)
  const setupVersionIds = [...new Set(
    packages.map(({ setup_version_id: setupVersionId }) => setupVersionId),
  )]
  const [invoices, draws, options, setupVersions] = await Promise.all([
    listRowsInBatches(
      client,
      packageIds,
      'invoices',
      INVOICE_COLUMNS,
      [['package_id', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'package_draws',
      DRAW_COLUMNS,
      [['package_id', true], ['draw_number', true], ['lot_number', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'package_options',
      OPTION_COLUMNS,
      [['package_id', true], ['lot_id', true], ['option_id', true]],
    ),
    Promise.all(inBatches(setupVersionIds).map((batch) => listAllRows(() => client
      .from('billing_setup_versions')
      .select(SETUP_COLUMNS)
      .in('id', batch)
      .order('id', { ascending: true }))
    )).then((rows) => rows.flat()),
  ])

  const invoicesByPackage = new Map(
    invoices.map((invoice) => [invoice.package_id, invoice]),
  )
  const drawsByPackage = groupByPackage(draws)
  const optionsByPackage = groupByPackage(options)
  const setupVersionsById = new Map(
    setupVersions.map((version) => [version.id, version]),
  )

  return packages.map((packageRow) => toDrawInvoicePackage(
    packageRow,
    invoicesByPackage.get(packageRow.id),
    drawsByPackage.get(packageRow.id) ?? [],
    optionsByPackage.get(packageRow.id) ?? [],
    setupVersionsById.get(packageRow.setup_version_id),
  ))
}

export async function createDrawInvoicePackage(input) {
  const client = await requireSupabase()
  const { data: packageId, error } = await client.rpc(
    'create_draw_invoice_package',
    toCreateDrawPackageRpc(input),
  )

  throwRepositoryError(error)

  const packages = await listDrawInvoicePackages()
  const created = packages.find(
    (record) => String(record.id) === String(packageId),
  )
  if (!created) {
    throw new Error('The created Draw & Invoice Package could not be reloaded.')
  }

  return { created, packages }
}

export async function updateDrawInvoicePackageStatus(packageId, status) {
  const client = await requireSupabase()
  const { data: updatedPackageId, error } = await client.rpc(
    'set_draw_package_workflow_status',
    toPackageStatusRpc(packageId, status),
  )

  throwRepositoryError(error)

  const packages = await listDrawInvoicePackages()
  const updated = packages.find(
    (record) => String(record.id) === String(updatedPackageId),
  )
  if (!updated) {
    throw new Error('The updated Draw & Invoice Package could not be reloaded.')
  }

  return { updated, packages }
}
