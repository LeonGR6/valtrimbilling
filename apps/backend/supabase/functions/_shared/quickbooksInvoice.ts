// Pure builder for the QuickBooks Online Invoice payload of a Package.
//
// No network, no database: it receives already-normalised charges and returns
// the JSON accepted by `POST /v3/company/{realmId}/invoice`. Every line uses the
// same Product/Service (Material Installation & Supply), Qty 1 and Rate equal to
// Amount. Draw/Options/Hardware/Utility lines carry the GROSS amount; Retention
// and Wrap are separate negative lines so the invoice total equals the Package
// net amount. A Price Adjustment Package has PRICE_ADJUSTMENT lines instead: the
// gross price difference of the Package it comes from, which may be negative (a
// credit that the other lines of the same invoice outweigh).

import type { InvoiceCustomField } from './quickbooksCustomFields.ts'

export type InvoiceLineFormat = 'LOT_SCOPE' | 'BUILDING_SCOPE'

export type PackageChargeKind = 'DRAW' | 'HARDWARE' | 'OPTIONS' | 'UTILITY' | 'PRICE_ADJUSTMENT'

export interface PackageCharge {
  phaseCode: string
  /** For UTILITY charges this is the Utility row label (e.g. "Utility 1"). */
  lotNumber: string
  building?: string | null
  kind: PackageChargeKind
  /** Required for DRAW charges; rendered as "DRAW 3". */
  drawNumber?: number
  /** Overrides the default scope text (e.g. a utility or hardware event). */
  scopeLabel?: string
  /** Gross amount in dollars. Negative only for a credit in a Price Adjustment. */
  amount: number
}

export interface QuickbooksInvoiceInput {
  customerId: string
  itemId: string
  txnDate: string
  dueDate?: string | null
  docNumber?: string | null
  privateNote?: string | null
  /** Optional QuickBooks TaxCode id (e.g. "NON"). Omitted from the payload when unset. */
  taxCodeId?: string | null
  /** Text custom fields of the invoice (e.g. Job Name, Job #). */
  customFields?: InvoiceCustomField[]
  invoiceLineFormat: InvoiceLineFormat
  charges: PackageCharge[]
  /** Package totals as positive magnitudes; they are sent as negative lines. */
  retentionAmount?: number
  wrapAmount?: number
  /** Package net amount. The built lines must add up to exactly this. */
  expectedNetAmount: number
}

export interface QuickbooksInvoiceLine {
  Amount: number
  DetailType: 'SalesItemLineDetail'
  Description: string
  SalesItemLineDetail: {
    ItemRef: { value: string }
    Qty: 1
    UnitPrice: number
    TaxCodeRef?: { value: string }
  }
}

export interface QuickbooksInvoiceCustomField {
  DefinitionId: string
  Name: string
  Type: 'StringType'
  StringValue: string
}

export interface QuickbooksInvoicePayload {
  CustomerRef: { value: string }
  TxnDate: string
  DueDate?: string
  DocNumber?: string
  PrivateNote?: string
  CustomField?: QuickbooksInvoiceCustomField[]
  Line: QuickbooksInvoiceLine[]
}

export type QuickbooksInvoiceErrorCode =
  | 'INVALID_INPUT'
  | 'NO_LINES'
  | 'TOTAL_MISMATCH'
  | 'UNSUPPORTED_PACKAGE'
  | 'PRODUCT_MISSING'
  | 'NUMBER_IN_USE'

export class QuickbooksInvoiceError extends Error {
  readonly code: QuickbooksInvoiceErrorCode

  constructor(code: QuickbooksInvoiceErrorCode, message: string) {
    super(message)
    this.name = 'QuickbooksInvoiceError'
    this.code = code
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
// QuickBooks Online limits DocNumber to 21 characters.
const DOC_NUMBER_MAX_LENGTH = 21
const KIND_RANK: Record<PackageChargeKind, number> = {
  DRAW: 0,
  HARDWARE: 1,
  OPTIONS: 2,
  UTILITY: 3,
  PRICE_ADJUSTMENT: 4,
}

const naturalCompare = (left: string, right: string) =>
  left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })

function toCents(amount: number, field: string) {
  if (!Number.isFinite(amount)) {
    throw new QuickbooksInvoiceError('INVALID_INPUT', `${field} must be a number.`)
  }
  return Math.round(amount * 100)
}

function fromCents(cents: number) {
  return cents / 100
}

function requireText(value: string | null | undefined, field: string) {
  const text = value?.trim()
  if (!text) {
    throw new QuickbooksInvoiceError('INVALID_INPUT', `${field} is required.`)
  }
  return text
}

function requireDate(value: string, field: string) {
  if (!DATE_PATTERN.test(value)) {
    throw new QuickbooksInvoiceError('INVALID_INPUT', `${field} must be YYYY-MM-DD.`)
  }
  return value
}

function phaseText(phaseCode: string) {
  const code = phaseCode.trim().replace(/^phase\s+/iu, '')
  return `PHASE ${code}`.toUpperCase()
}

/** "97, 98, 99, 102, 12A" -> "97-99, 102, 12A". */
export function formatLotRanges(lotNumbers: string[]) {
  const unique = [...new Set(lotNumbers.map((lot) => lot.trim()))]
  const numeric = unique
    .filter((lot) => /^\d+$/u.test(lot))
    .map(Number)
    .sort((left, right) => left - right)
  const other = unique.filter((lot) => !/^\d+$/u.test(lot)).sort(naturalCompare)

  const parts: string[] = []
  for (let index = 0; index < numeric.length;) {
    let end = index
    while (numeric[end + 1] === numeric[end] + 1) end += 1
    parts.push(end > index ? `${numeric[index]}-${numeric[end]}` : `${numeric[index]}`)
    index = end + 1
  }
  return [...parts, ...other].join(', ')
}

function scopeText(charge: PackageCharge) {
  if (charge.scopeLabel?.trim()) return charge.scopeLabel.trim().toUpperCase()
  if (charge.kind === 'DRAW') {
    if (!Number.isInteger(charge.drawNumber)) {
      throw new QuickbooksInvoiceError(
        'INVALID_INPUT',
        `Lot ${charge.lotNumber}: a DRAW charge needs a drawNumber.`,
      )
    }
    return `DRAW ${charge.drawNumber}`
  }
  return charge.kind.replaceAll('_', ' ')
}

interface LineGroup {
  phaseCode: string
  building: string | null
  kind: PackageChargeKind
  drawNumber: number
  scope: string
  lots: string[]
  cents: number
}

function groupCharges(charges: PackageCharge[], format: InvoiceLineFormat) {
  const groups = new Map<string, LineGroup>()

  for (const charge of charges) {
    const cents = toCents(charge.amount, `Lot ${charge.lotNumber} amount`)
    if (cents === 0) continue

    // Utility rows are not lots in a building: they always get a line of their own.
    // A Phase without a building has nothing to split by, so its lots are grouped by
    // Phase, like the other Phases of a Builder that bills one line per Phase.
    const building = charge.building?.trim() || null
    const byBuilding = format === 'BUILDING_SCOPE' && charge.kind !== 'UTILITY' && building !== null

    const scope = scopeText(charge)
    const key = [
      charge.phaseCode.trim(),
      byBuilding ? building : '',
      charge.kind,
      scope,
      charge.kind === 'UTILITY' ? charge.lotNumber.trim() : '',
    ].join('|')
    const group = groups.get(key) ?? {
      phaseCode: charge.phaseCode.trim(),
      building: byBuilding ? building : null,
      kind: charge.kind,
      drawNumber: charge.drawNumber ?? 0,
      scope,
      lots: [],
      cents: 0,
    }
    group.lots.push(charge.lotNumber)
    group.cents += cents
    groups.set(key, group)
  }

  // A group whose charges cancel out has nothing to invoice.
  return [...groups.values()].filter((group) => group.cents !== 0).sort(
    (left, right) =>
      naturalCompare(left.phaseCode, right.phaseCode)
      || Number(left.kind === 'UTILITY') - Number(right.kind === 'UTILITY')
      || naturalCompare(left.building ?? '', right.building ?? '')
      || KIND_RANK[left.kind] - KIND_RANK[right.kind]
      || left.drawNumber - right.drawNumber
      || naturalCompare(left.scope, right.scope),
  )
}

function describe(group: LineGroup) {
  if (group.kind === 'UTILITY') {
    return `${phaseText(group.phaseCode)} ${group.lots[0].trim().toUpperCase()}\n${group.scope}`
  }
  // The lots are always named, also on a line that groups a whole building.
  const lots = `${new Set(group.lots).size > 1 ? 'LOTS' : 'LOT'} #${formatLotRanges(group.lots)}`
  const place = group.building ? `BUILDING ${group.building.toUpperCase()} ${lots}` : lots
  return `${phaseText(group.phaseCode)} ${place}\n${group.scope}`
}

// QuickBooks limits an invoice number (DocNumber) to 21 characters.
const INVOICE_NUMBER_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]{0,20}$/u

/** The invoice number a person typed, trimmed, or an error that says what is wrong with it. */
export function parseInvoiceNumber(value: unknown) {
  const number = typeof value === 'string' ? value.trim() : ''
  if (!INVOICE_NUMBER_PATTERN.test(number)) {
    throw new QuickbooksInvoiceError(
      'INVALID_INPUT',
      'Enter an invoice number of up to 21 letters, numbers, dots or dashes.',
    )
  }
  return number
}

/** YYYY-MM-DD plus a number of days, computed in UTC so the host timezone cannot shift it. */
export function dueDateFor(txnDate: string, paymentTermsDays: number | null | undefined) {
  requireDate(txnDate, 'txnDate')
  if (paymentTermsDays == null) return undefined
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0) {
    throw new QuickbooksInvoiceError('INVALID_INPUT', 'paymentTermsDays must be a whole number of days.')
  }
  const due = new Date(`${txnDate}T00:00:00Z`)
  due.setUTCDate(due.getUTCDate() + paymentTermsDays)
  return due.toISOString().slice(0, 10)
}

export function buildQuickbooksInvoicePayload(
  input: QuickbooksInvoiceInput,
): QuickbooksInvoicePayload {
  const customerId = requireText(input.customerId, 'customerId')
  const itemId = requireText(input.itemId, 'itemId')
  const txnDate = requireDate(input.txnDate, 'txnDate')
  const dueDate = input.dueDate ? requireDate(input.dueDate, 'dueDate') : undefined
  const docNumber = input.docNumber?.trim() || undefined
  if (docNumber && docNumber.length > DOC_NUMBER_MAX_LENGTH) {
    throw new QuickbooksInvoiceError(
      'INVALID_INPUT',
      `docNumber cannot exceed ${DOC_NUMBER_MAX_LENGTH} characters.`,
    )
  }
  const taxCodeId = input.taxCodeId?.trim() || undefined

  const retentionCents = toCents(input.retentionAmount ?? 0, 'retentionAmount')
  const wrapCents = toCents(input.wrapAmount ?? 0, 'wrapAmount')
  if (retentionCents < 0 || wrapCents < 0) {
    throw new QuickbooksInvoiceError(
      'INVALID_INPUT',
      'retentionAmount and wrapAmount are positive magnitudes; they are negated on the invoice.',
    )
  }

  const toLine = (description: string, cents: number): QuickbooksInvoiceLine => ({
    Amount: fromCents(cents),
    DetailType: 'SalesItemLineDetail',
    Description: description,
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: 1,
      UnitPrice: fromCents(cents),
      ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId } } : {}),
    },
  })

  const lines = groupCharges(input.charges, input.invoiceLineFormat).map((group) =>
    toLine(describe(group), group.cents)
  )
  if (retentionCents > 0) lines.push(toLine('RETENTION', -retentionCents))
  if (wrapCents > 0) lines.push(toLine('WRAP', -wrapCents))

  if (lines.length === 0) {
    throw new QuickbooksInvoiceError('NO_LINES', 'The package has nothing to invoice.')
  }

  const totalCents = lines.reduce((sum, line) => sum + toCents(line.Amount, 'line'), 0)
  const expectedCents = toCents(input.expectedNetAmount, 'expectedNetAmount')
  if (totalCents !== expectedCents) {
    throw new QuickbooksInvoiceError(
      'TOTAL_MISMATCH',
      `Invoice lines add up to ${fromCents(totalCents).toFixed(2)} but the package net amount is ${
        fromCents(expectedCents).toFixed(2)
      }.`,
    )
  }

  return {
    CustomerRef: { value: customerId },
    TxnDate: txnDate,
    ...(dueDate ? { DueDate: dueDate } : {}),
    ...(docNumber ? { DocNumber: docNumber } : {}),
    ...(input.privateNote?.trim() ? { PrivateNote: input.privateNote.trim() } : {}),
    ...(input.customFields?.length
      ? {
        CustomField: input.customFields.map(({ definitionId, name, value }) => ({
          DefinitionId: definitionId,
          Name: name,
          Type: 'StringType' as const,
          StringValue: value,
        })),
      }
      : {}),
    Line: lines,
  }
}
