// Reads everything needed to invoice one Package. The caller has already
// checked the user's role; this uses the service client because the rows span
// several tables whose column grants are narrower than the invoice needs.

import type { serviceClient } from './supabase.ts'
import type { PackageInvoiceSource } from './quickbooksPackageCharges.ts'

type Admin = ReturnType<typeof serviceClient>

export interface LoadedPackage {
  packageId: number
  packageNumber: string
  quickbooksStatus: string
  builder: { id: number; name: string }
  /** Job Name in QuickBooks is the community; Job # is the Job code. */
  job: { code: string; community: string | null }
  paymentTermsDays: number | null
  source: PackageInvoiceSource
}

export class PackageNotFoundError extends Error {
  constructor() {
    super('The Package does not exist.')
    this.name = 'PackageNotFoundError'
  }
}

function orThrow<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function loadPackageSource(admin: Admin, packageId: number): Promise<LoadedPackage> {
  const header = orThrow(
    await admin
      .from('draw_packages')
      .select(
        'id, package_number, package_type, status, quickbooks_status, invoice_line_format, builder_id, job_id, setup_version_id',
      )
      .eq('id', packageId)
      .maybeSingle(),
  )
  if (!header) throw new PackageNotFoundError()

  const [draws, hardwareLines, invoice, builder, job, setup] = await Promise.all([
    admin
      .from('package_draws')
      .select(
        'lot_number, phase_code, building, draw_number, is_utility_building, utility_name, utility_event_type, utility_amount, base_draw_amount, hardware_amount, hardware_event_type, options_amount, retention_amount, wrap_amount',
      )
      .eq('package_id', packageId)
      .order('lot_id')
      .order('draw_id'),
    admin
      .from('package_hardware_lines')
      .select(
        'lot_number, phase_code, building, hardware_event_type, hardware_amount, retention_amount, wrap_amount',
      )
      .eq('package_id', packageId)
      .order('id'),
    admin.from('invoices').select('net_amount').eq('package_id', packageId).maybeSingle(),
    admin.from('builders').select('id, name').eq('id', header.builder_id).single(),
    admin.from('jobs').select('code, community').eq('id', header.job_id).single(),
    admin
      .from('billing_setup_versions')
      .select('payment_terms_days')
      .eq('id', header.setup_version_id)
      .maybeSingle(),
  ])

  const builderRow = orThrow(builder)
  if (!builderRow) throw new Error('The Package Builder no longer exists.')
  const jobRow = orThrow(job)
  if (!jobRow) throw new Error('The Package Job no longer exists.')
  const setupRow = orThrow(setup)

  return {
    packageId,
    packageNumber: header.package_number,
    quickbooksStatus: header.quickbooks_status,
    builder: { id: builderRow.id, name: builderRow.name },
    job: { code: jobRow.code, community: jobRow.community ?? null },
    paymentTermsDays: setupRow?.payment_terms_days ?? null,
    source: {
      package: header,
      draws: orThrow(draws) ?? [],
      hardwareLines: orThrow(hardwareLines) ?? [],
      invoice: orThrow(invoice),
    },
  }
}
