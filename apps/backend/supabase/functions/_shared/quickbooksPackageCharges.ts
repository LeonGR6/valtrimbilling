// Maps the database rows of a Draw Package to the normalised charges consumed
// by `buildQuickbooksInvoicePayload`.
//
// Pure: callers fetch the rows (package_draws, package_hardware_lines, invoice)
// and pass them in. PostgREST returns `numeric` columns as numbers, but SQL
// clients may return strings, so amounts are accepted as either.

import {
  type InvoiceLineFormat,
  type PackageCharge,
  QuickbooksInvoiceError,
} from './quickbooksInvoice.ts'

type Numeric = number | string

export interface PackageHeaderRow {
  package_type: string
  status: string
  invoice_line_format: string
}

export interface PackageDrawRow {
  lot_number: string
  phase_code: string
  building: string | null
  draw_number: number
  is_utility_building: boolean
  utility_name: string | null
  utility_event_type: string | null
  utility_amount: Numeric
  base_draw_amount: Numeric
  hardware_amount: Numeric
  hardware_event_type: string | null
  options_amount: Numeric
  retention_amount: Numeric
  wrap_amount: Numeric
}

export interface PackageHardwareLineRow {
  lot_number: string
  phase_code: string
  building: string | null
  hardware_event_type: string | null
  hardware_amount: Numeric
  retention_amount: Numeric
  wrap_amount: Numeric
}

export interface PackageInvoiceRow {
  net_amount: Numeric
}

export interface PackageInvoiceSource {
  package: PackageHeaderRow
  draws: PackageDrawRow[]
  hardwareLines: PackageHardwareLineRow[]
  invoice: PackageInvoiceRow | null
}

export interface PackageInvoiceCharges {
  invoiceLineFormat: InvoiceLineFormat
  charges: PackageCharge[]
  /** Positive magnitudes, summed over every draw and hardware row. */
  retentionAmount: number
  wrapAmount: number
  expectedNetAmount: number
}

function cents(value: Numeric, field: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) {
    throw new QuickbooksInvoiceError('INVALID_INPUT', `${field} is not a number.`)
  }
  return Math.round(amount * 100)
}

function eventScope(base: string, eventType: string | null) {
  return eventType ? `${base} - ${eventType}` : undefined
}

export function mapPackageToCharges(source: PackageInvoiceSource): PackageInvoiceCharges {
  const { package: header, draws, hardwareLines, invoice } = source

  if (header.package_type !== 'DRAW') {
    throw new QuickbooksInvoiceError(
      'UNSUPPORTED_PACKAGE',
      `${header.package_type} packages cannot be sent to QuickBooks yet.`,
    )
  }
  if (header.status === 'VOIDED') {
    throw new QuickbooksInvoiceError('UNSUPPORTED_PACKAGE', 'A voided package cannot be invoiced.')
  }
  if (!invoice) {
    throw new QuickbooksInvoiceError('INVALID_INPUT', 'The package has no invoice totals yet.')
  }
  if (header.invoice_line_format !== 'LOT_SCOPE' && header.invoice_line_format !== 'BUILDING_SCOPE') {
    throw new QuickbooksInvoiceError(
      'INVALID_INPUT',
      `Unknown invoice line format ${header.invoice_line_format}.`,
    )
  }

  const charges: PackageCharge[] = []
  let retentionCents = 0
  let wrapCents = 0

  for (const row of draws) {
    retentionCents += cents(row.retention_amount, 'retention_amount')
    wrapCents += cents(row.wrap_amount, 'wrap_amount')

    const place = {
      phaseCode: row.phase_code,
      building: row.building,
    }

    if (row.is_utility_building) {
      const label = row.utility_name?.trim()
      if (!label) {
        throw new QuickbooksInvoiceError(
          'INVALID_INPUT',
          `Utility row ${row.lot_number} has no utility name.`,
        )
      }
      charges.push({
        ...place,
        lotNumber: label,
        kind: 'UTILITY',
        scopeLabel: eventScope('UTILITY', row.utility_event_type),
        amount: Number(row.utility_amount),
      })
      continue
    }

    charges.push({
      ...place,
      lotNumber: row.lot_number,
      kind: 'DRAW',
      drawNumber: row.draw_number,
      amount: Number(row.base_draw_amount),
    })
    charges.push({
      ...place,
      lotNumber: row.lot_number,
      kind: 'HARDWARE',
      scopeLabel: eventScope('HARDWARE', row.hardware_event_type),
      amount: Number(row.hardware_amount),
    })
    charges.push({
      ...place,
      lotNumber: row.lot_number,
      kind: 'OPTIONS',
      amount: Number(row.options_amount),
    })
  }

  for (const row of hardwareLines) {
    retentionCents += cents(row.retention_amount, 'retention_amount')
    wrapCents += cents(row.wrap_amount, 'wrap_amount')
    charges.push({
      phaseCode: row.phase_code,
      building: row.building,
      lotNumber: row.lot_number,
      kind: 'HARDWARE',
      scopeLabel: eventScope('HARDWARE', row.hardware_event_type),
      amount: Number(row.hardware_amount),
    })
  }

  return {
    invoiceLineFormat: header.invoice_line_format,
    charges,
    retentionAmount: retentionCents / 100,
    wrapAmount: wrapCents / 100,
    expectedNetAmount: cents(invoice.net_amount, 'net_amount') / 100,
  }
}
