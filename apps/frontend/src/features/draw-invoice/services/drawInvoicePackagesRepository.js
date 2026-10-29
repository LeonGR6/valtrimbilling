import { requireSupabase } from '../../../services/api.js'
import {
  toCancelDrawPackageRpc,
  toCreateDrawPackageRpc,
  toCreatePriceAdjustmentPackageRpc,
  toCreateRetentionReleasePackageRpc,
  toDrawInvoicePackage,
  toEditDrawPackageRpc,
  toPackageStatusRpc,
  toTransferDrawPackageRpc,
} from './drawInvoicePackageRecord.js'
import { inBatches, listAllRows as listPagedRows } from '../../../services/pagedQuery.js'

const PACKAGE_COLUMNS = [
  'id',
  'package_number',
  'package_type',
  'builder_id',
  'job_id',
  'phase_id',
  'setup_version_id',
  'package_date',
  'invoice_line_format',
  'workflow_status',
  'status',
  'quickbooks_status',
  'quickbooks_reference',
  'quickbooks_environment',
  // How QuickBooks shows the invoice (open, overdue, paid...), when it was read.
  'quickbooks_invoice_syncs(qbo_state, qbo_overdue)',
  'voided_at',
  'void_reason',
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
  'phase_id',
  'phase_code',
  'building',
  'lot_id',
  'draw_id',
  'lot_number',
  'utility_name',
  'plan_code',
  'base_price',
  'draw_number',
  'draw_name',
  'base_draw_amount',
  'hardware_amount',
  'hardware_billing_mode',
  'hardware_event_type',
  'hardware_percentage',
  'options_amount',
  'is_utility_building',
  'utility_amount',
  'utility_billing_mode',
  'utility_event_type',
  'utility_percentage',
  'gross_amount',
  'retention_amount',
  'wrap_amount',
  'net_amount',
].join(', ')

const HARDWARE_COLUMNS = [
  'id',
  'package_id',
  'phase_id',
  'phase_code',
  'building',
  'lot_id',
  'lot_number',
  'plan_code',
  'hardware_price',
  'hardware_event_type',
  'hardware_percentage',
  'hardware_amount',
  'gross_amount',
  'retention_amount',
  'wrap_amount',
  'net_amount',
].join(', ')

const BILLING_DRAW_COLUMNS = [
  'id',
  'setup_version_id',
  'event_type',
].join(', ')

const OPTION_COLUMNS = [
  'package_id',
  'billing_lot_id',
  'lot_id',
  'option_id',
  'draw_id',
  'option_code',
  'option_name',
  'option_price',
  'option_not_applicable',
  'phase_id',
  'phase_code',
  'building',
  'lot_number',
  'plan_code',
].join(', ')

const SETUP_COLUMNS = [
  'id',
  'separate_hardware_price',
  'hardware_billing_mode',
  'hardware_ext_percentage',
  'hardware_dm_percentage',
  'hardware_hw_percentage',
  'utility_building',
  'utility_billing_mode',
  'utility_ext_percentage',
  'utility_dm_percentage',
  'utility_hw_percentage',
  'options_billing_draw_number',
  'frequency',
  'cutoff_any_date',
  'cutoff_day',
  'cutoff_days',
  'cutoff_weekday',
  'payment_terms_days',
  'retention_release_scope',
  'submission_method',
  'submission_destination',
  'portal_name',
].join(', ')

const CORRECTION_COLUMNS = [
  'id',
  'package_id',
  'other_package_id',
  'action',
  'removed_cells',
  'added_cells',
  'previous_details',
  'next_details',
  'reason',
  'changed_by',
  'changed_at',
].join(', ')

const RETENTION_RELEASE_COLUMNS = [
  'package_id',
  'job_id',
  'scope_type',
  'phase_id',
  'phase_code',
  'building',
  'source_cutoff_date',
  'available_date',
  'retained_amount',
].join(', ')

const RETENTION_RELEASE_LINE_COLUMNS = [
  'package_id',
  'source_package_id',
  'source_lot_id',
  'source_draw_id',
  'phase_id',
  'retention_amount',
].join(', ')

const RETENTION_RELEASE_HARDWARE_LINE_COLUMNS = [
  'package_id',
  'source_hardware_line_id',
  'source_package_id',
  'source_lot_id',
  'hardware_event_type',
  'phase_id',
  'retention_amount',
].join(', ')

const RETENTION_RELEASE_ADJUSTMENT_LINE_COLUMNS = [
  'package_id',
  'source_adjustment_line_id',
  'source_package_id',
  'phase_id',
  'retention_amount',
].join(', ')

const PRICE_ADJUSTMENT_COLUMNS = [
  'package_id',
  'job_id',
  'source_package_count',
  'line_count',
  'gross_amount',
  'retention_amount',
  'wrap_amount',
  'net_amount',
].join(', ')

const PRICE_ADJUSTMENT_LINE_COLUMNS = [
  'id',
  'package_id',
  'source_package_id',
  'source_package_number',
  'line_kind',
  'lot_id',
  'draw_number',
  'hardware_event_type',
  'phase_id',
  'phase_code',
  'building',
  'lot_number',
  'plan_code',
  'delta_base',
  'delta_hardware',
  'delta_utility',
  'delta_options',
  'gross',
  'retention',
  'wrap',
  'net',
].join(', ')

function throwRepositoryError(error, operation = 'write') {
  if (!error) return

  if (error.code === '42501') {
    const message = operation === 'read'
      ? 'You do not have permission to view Draw & Invoice Packages.'
      : 'You do not have permission to change Draw & Invoice Packages.'
    throw new Error(message, {
      cause: error,
    })
  }

  if (error.code === '23505') {
    if (error.message?.includes('Option') || error.message?.includes('Hardware')) {
      throw new Error(error.message, { cause: error })
    }
    throw new Error(error.message || 'One or more Lot / Draw cells belong to another Package.', {
      cause: error,
    })
  }

  if (error.code === '23503' || error.code === 'P0002') {
    throw new Error('A selected Package, Phase, Lot, Draw or Billing Setup is no longer available.', {
      cause: error,
    })
  }

  if (error.message?.includes('unissued, unsynced draft Package')) {
    throw new Error(
      `${error.message}. A Package with a generated Release, a QuickBooks `
      + 'reference, a submission or a payment is locked: remove its generated '
      + 'Release first, or ask an administrator if it was issued or synced.',
      { cause: error },
    )
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

// Every row of a query, page by page, throwing this repository's error.
const listAllRows = (queryFactory) => listPagedRows(queryFactory, (error) => throwRepositoryError(error, 'read'))

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
  const [
    invoices,
    draws,
    hardwareLines,
    options,
    corrections,
    setupVersions,
    billingDraws,
    retentionReleases,
    retentionReleaseLines,
    retentionReleaseHardwareLines,
    priceAdjustments,
    priceAdjustmentLines,
    retentionReleaseAdjustmentLines,
  ] = await Promise.all([
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
      [['package_id', true], ['phase_code', true], ['draw_number', true], ['lot_number', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'package_hardware_lines',
      HARDWARE_COLUMNS,
      [['package_id', true], ['phase_code', true], ['lot_number', true], ['hardware_event_type', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'package_options',
      OPTION_COLUMNS,
      [['package_id', true], ['lot_id', true], ['option_id', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'draw_package_corrections',
      CORRECTION_COLUMNS,
      [['package_id', true], ['changed_at', false]],
    ),
    Promise.all(inBatches(setupVersionIds).map((batch) => listAllRows(() => client
      .from('billing_setup_versions')
      .select(SETUP_COLUMNS)
      .in('id', batch)
      .order('id', { ascending: true }))
    )).then((rows) => rows.flat()),
    Promise.all(inBatches(setupVersionIds).map((batch) => listAllRows(() => client
      .from('billing_draws')
      .select(BILLING_DRAW_COLUMNS)
      .in('setup_version_id', batch)
      .order('id', { ascending: true }))
    )).then((rows) => rows.flat()),
    listRowsInBatches(
      client,
      packageIds,
      'retention_releases',
      RETENTION_RELEASE_COLUMNS,
      [['package_id', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'retention_release_lines',
      RETENTION_RELEASE_LINE_COLUMNS,
      [['package_id', true], ['source_package_id', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'retention_release_hardware_lines',
      RETENTION_RELEASE_HARDWARE_LINE_COLUMNS,
      [['package_id', true], ['source_package_id', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'price_adjustments',
      PRICE_ADJUSTMENT_COLUMNS,
      [['package_id', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'price_adjustment_lines',
      PRICE_ADJUSTMENT_LINE_COLUMNS,
      [['package_id', true], ['source_package_id', true], ['id', true]],
    ),
    listRowsInBatches(
      client,
      packageIds,
      'retention_release_adjustment_lines',
      RETENTION_RELEASE_ADJUSTMENT_LINE_COLUMNS,
      [['package_id', true], ['source_adjustment_line_id', true]],
    ),
  ])

  const invoicesByPackage = new Map(
    invoices.map((invoice) => [invoice.package_id, invoice]),
  )
  const drawsByPackage = groupByPackage(draws)
  const hardwareLinesByPackage = groupByPackage(hardwareLines)
  const optionsByPackage = groupByPackage(options)
  const correctionsByPackage = groupByPackage(corrections)
  const correctionsBySource = corrections.reduce((grouped, correction) => {
    if (correction.other_package_id != null) {
      const items = grouped.get(correction.other_package_id) ?? []
      items.push(correction)
      grouped.set(correction.other_package_id, items)
    }
    return grouped
  }, new Map())
  const setupVersionsById = new Map(
    setupVersions.map((version) => [version.id, version]),
  )
  const billingDrawsById = new Map(
    billingDraws.map((draw) => [draw.id, draw]),
  )
  const retentionReleasesByPackage = new Map(
    retentionReleases.map((release) => [release.package_id, release]),
  )
  const retentionReleaseLinesByPackage = groupByPackage(retentionReleaseLines)
  const retentionReleaseHardwareLinesByPackage = groupByPackage(
    retentionReleaseHardwareLines,
  )
  const priceAdjustmentsByPackage = new Map(
    priceAdjustments.map((adjustment) => [adjustment.package_id, adjustment]),
  )
  const priceAdjustmentLinesByPackage = groupByPackage(priceAdjustmentLines)
  const retentionReleaseAdjustmentLinesByPackage = groupByPackage(
    retentionReleaseAdjustmentLines,
  )

  return packages.map((packageRow) => toDrawInvoicePackage(
    packageRow,
    invoicesByPackage.get(packageRow.id),
    (drawsByPackage.get(packageRow.id) ?? []).map((draw) => ({
      ...draw,
      event_type: billingDrawsById.get(draw.draw_id)?.event_type ?? null,
    })),
    optionsByPackage.get(packageRow.id) ?? [],
    setupVersionsById.get(packageRow.setup_version_id),
    [
      ...(correctionsByPackage.get(packageRow.id) ?? []),
      ...(correctionsBySource.get(packageRow.id) ?? []),
    ].sort((left, right) => right.changed_at.localeCompare(left.changed_at)),
    retentionReleasesByPackage.get(packageRow.id),
    retentionReleaseLinesByPackage.get(packageRow.id) ?? [],
    hardwareLinesByPackage.get(packageRow.id) ?? [],
    retentionReleaseHardwareLinesByPackage.get(packageRow.id) ?? [],
    priceAdjustmentsByPackage.get(packageRow.id),
    priceAdjustmentLinesByPackage.get(packageRow.id) ?? [],
    retentionReleaseAdjustmentLinesByPackage.get(packageRow.id) ?? [],
  ))
}

export async function createDrawInvoicePackage(input) {
  const client = await requireSupabase()
  const { data: packageId, error } = await client.rpc(
    'create_draw_invoice_package_with_hardware_events',
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

export async function createRetentionReleasePackage(input) {
  const client = await requireSupabase()
  const { data: packageId, error } = await client.rpc(
    'create_retention_release_package',
    toCreateRetentionReleasePackageRpc(input),
  )

  throwRepositoryError(error)

  const packages = await listDrawInvoicePackages()
  const created = packages.find(
    (record) => String(record.id) === String(packageId),
  )
  if (!created) {
    throw new Error('The created Retention Package could not be reloaded.')
  }

  return { created, packages }
}

export async function createPriceAdjustmentPackage(input) {
  const client = await requireSupabase()
  const { data: packageId, error } = await client.rpc(
    'create_price_adjustment_package',
    toCreatePriceAdjustmentPackageRpc(input),
  )

  throwRepositoryError(error)

  const packages = await listDrawInvoicePackages()
  const created = packages.find(
    (record) => String(record.id) === String(packageId),
  )
  if (!created) {
    throw new Error('The created Price Adjustment Package could not be reloaded.')
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

async function correctDrawInvoicePackage(rpcName, payload) {
  const client = await requireSupabase()
  const { data: packageId, error } = await client.rpc(rpcName, payload)
  throwRepositoryError(error)

  const packages = await listDrawInvoicePackages()
  const updated = packages.find(
    (record) => String(record.id) === String(packageId),
  )
  if (!updated) {
    throw new Error('The corrected Draw Package could not be reloaded.')
  }
  return { updated, packages }
}

export function editDrawInvoicePackage(input) {
  return correctDrawInvoicePackage(
    'edit_draw_invoice_package',
    toEditDrawPackageRpc(input),
  )
}

export function transferDrawPackageCells(input) {
  return correctDrawInvoicePackage(
    'transfer_draw_package_cells',
    toTransferDrawPackageRpc(input),
  )
}

export function cancelDrawInvoicePackage(packageId, reason) {
  return correctDrawInvoicePackage(
    'cancel_draw_invoice_package',
    toCancelDrawPackageRpc(packageId, reason),
  )
}
