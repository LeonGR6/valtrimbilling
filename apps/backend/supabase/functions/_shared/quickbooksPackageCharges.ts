// Maps the database rows of a Draw Package, of a Price Adjustment Package or of a Package of Options
// only to the normalised charges consumed by `buildQuickbooksInvoicePayload`.
//
// Pure: callers fetch the rows (package_draws, package_hardware_lines, package_options,
// price_adjustment_lines, invoice) and pass them in. PostgREST returns `numeric` columns as numbers, but SQL
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

/** One option billed by the Package, with the Lot it belongs to (not the Lot of the line it is billed on). */
export interface PackageOptionRow {
  lot_number: string
  phase_code: string
  building: string | null
  option_price: Numeric
  /** What an Options Package withholds of the Option; a Draw Package keeps it on its Draw lines. */
  retention_amount?: Numeric
  wrap_amount?: Numeric
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

/** One price difference collected by a Price Adjustment Package. Amounts are signed. */
export interface PackageAdjustmentLineRow {
  /** The Package that billed the difference, e.g. DP-00000035. */
  source_package_number: string
  line_kind: string
  lot_number: string
  is_utility_building?: boolean
  utility_name?: string | null
  phase_code: string
  building: string | null
  draw_number: number | null
  hardware_event_type: string | null
  gross: Numeric
  retention: Numeric
  wrap: Numeric
}

export interface PackageInvoiceRow {
  net_amount: Numeric
}

export interface PackageInvoiceSource {
  package: PackageHeaderRow
  draws: PackageDrawRow[]
  hardwareLines: PackageHardwareLineRow[]
  /**
   * The options the Package bills, one row each. Their amount is charged on a single draw line, but
   * they belong to several Lots, and the invoice names those Lots. A Package of Options only has
   * these rows and nothing else.
   */
  optionLines?: PackageOptionRow[]
  /** Only a Price Adjustment Package has them. */
  adjustmentLines?: PackageAdjustmentLineRow[]
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

/**
 * The OPTIONS charges, one per Lot that has options, when the option rows can stand for the amounts
 * of the draw lines; null when they cannot, and the amount of each draw line is charged as it is.
 *
 * A Package charges its options on one draw line (the first Draw it bills at or after the Options
 * Draw), so that line holds the whole amount even when the options belong to many Lots. The invoice
 * names the Lots of the options, so it takes them from the option rows. That is only done when the
 * rows add up to exactly what the lines bill, so the invoice total can never change because of it.
 */
function optionChargesByLot(optionLines: PackageOptionRow[]): PackageCharge[] {
  const byLot = new Map<string, PackageCharge & { cents: number }>()
  for (const row of optionLines) {
    const key = [row.phase_code, row.building ?? '', row.lot_number].join('|')
    const charge = byLot.get(key) ?? {
      phaseCode: row.phase_code,
      building: row.building,
      lotNumber: row.lot_number,
      kind: 'OPTIONS' as const,
      amount: 0,
      cents: 0,
    }
    charge.cents += cents(row.option_price, 'option_price')
    charge.amount = charge.cents / 100
    byLot.set(key, charge)
  }
  return [...byLot.values()].map(({ cents: _cents, ...charge }) => charge)
}

function optionCharges(
  draws: PackageDrawRow[],
  optionLines: PackageOptionRow[],
): PackageCharge[] | null {
  if (optionLines.length === 0) return null

  const billed = draws.reduce((sum, row) => sum + cents(row.options_amount, 'options_amount'), 0)
  const listed = optionLines.reduce((sum, row) => sum + cents(row.option_price, 'option_price'), 0)
  if (billed !== listed) return null

  return optionChargesByLot(optionLines)
}

export function mapPackageToCharges(source: PackageInvoiceSource): PackageInvoiceCharges {
  const { package: header, draws, hardwareLines, invoice } = source
  const adjustmentLines = source.adjustmentLines ?? []

  // A Retention Release is not sent to QuickBooks yet.
  if (
    header.package_type !== 'DRAW'
    && header.package_type !== 'PRICE_ADJUSTMENT'
    && header.package_type !== 'OPTIONS'
  ) {
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

  if (header.package_type === 'PRICE_ADJUSTMENT') {
    if (adjustmentLines.length === 0) {
      throw new QuickbooksInvoiceError(
        'INVALID_INPUT',
        'The Price Adjustment has no difference lines.',
      )
    }
    if (draws.length > 0 || hardwareLines.length > 0) {
      throw new QuickbooksInvoiceError(
        'INVALID_INPUT',
        'A Price Adjustment cannot have Draw or Hardware lines.',
      )
    }

    for (const row of adjustmentLines) {
      retentionCents += cents(row.retention, 'retention')
      wrapCents += cents(row.wrap, 'wrap')

      const place = { phaseCode: row.phase_code, building: row.building }
      const where = row.line_kind === 'HARDWARE_EVENT'
        ? `HARDWARE${row.hardware_event_type ? ` ${row.hardware_event_type}` : ''}`
        : `DRAW ${row.draw_number}`
      const scopeLabel = `PRICE ADJUSTMENT ${row.source_package_number} · ${where}`

      if (row.is_utility_building) {
        const label = row.utility_name?.trim()
        if (!label) {
          throw new QuickbooksInvoiceError(
            'INVALID_INPUT',
            `Utility row ${row.lot_number} has no utility name.`,
          )
        }
        charges.push({ ...place, lotNumber: label, kind: 'UTILITY', scopeLabel, amount: Number(row.gross) })
        continue
      }
      charges.push({
        ...place,
        lotNumber: row.lot_number,
        kind: 'PRICE_ADJUSTMENT',
        scopeLabel,
        amount: Number(row.gross),
      })
    }

    // The invoice shows Retention and WRAP as negative lines, so each must add up
    // to a positive amount: credits only ever reduce what the charges retained.
    if (retentionCents < 0 || wrapCents < 0) {
      throw new QuickbooksInvoiceError(
        'INVALID_INPUT',
        'The Price Adjustment retention or WRAP adds up to a negative amount.',
      )
    }

    return {
      invoiceLineFormat: header.invoice_line_format,
      charges,
      retentionAmount: retentionCents / 100,
      wrapAmount: wrapCents / 100,
      expectedNetAmount: cents(invoice.net_amount, 'net_amount') / 100,
    }
  }

  if (header.package_type === 'OPTIONS') {
    const optionLines = source.optionLines ?? []
    if (optionLines.length === 0) {
      throw new QuickbooksInvoiceError('INVALID_INPUT', 'The Options Package has no options.')
    }
    if (draws.length > 0 || hardwareLines.length > 0) {
      throw new QuickbooksInvoiceError(
        'INVALID_INPUT',
        'An Options Package cannot have Draw or Hardware lines.',
      )
    }

    // The Package withholds retention and WRAP Option by Option, so they are summed over the rows.
    for (const row of optionLines) {
      retentionCents += cents(row.retention_amount ?? 0, 'retention_amount')
      wrapCents += cents(row.wrap_amount ?? 0, 'wrap_amount')
    }
    if (retentionCents < 0 || wrapCents < 0) {
      throw new QuickbooksInvoiceError(
        'INVALID_INPUT',
        'The Options Package retention or WRAP adds up to a negative amount.',
      )
    }

    return {
      invoiceLineFormat: header.invoice_line_format,
      charges: optionChargesByLot(optionLines),
      retentionAmount: retentionCents / 100,
      wrapAmount: wrapCents / 100,
      expectedNetAmount: cents(invoice.net_amount, 'net_amount') / 100,
    }
  }

  const perLotOptions = optionCharges(draws, source.optionLines ?? [])
  if (perLotOptions) charges.push(...perLotOptions)

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
    if (!perLotOptions) {
      charges.push({
        ...place,
        lotNumber: row.lot_number,
        kind: 'OPTIONS',
        amount: Number(row.options_amount),
      })
    }
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
