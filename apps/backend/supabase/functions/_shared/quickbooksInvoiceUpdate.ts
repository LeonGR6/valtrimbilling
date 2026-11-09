// Edits a Package that is already invoiced and changes the SAME QuickBooks invoice: its number, date,
// customer and custom fields stay, only its lines (and so its total) change.
//
// Order matters, and every step can be repeated:
//   1. QuickBooks is read first. The invoice must still be what we sent: no payment or credit, not
//      voided, not edited by hand there. Nothing is changed if it is not.
//   2. The database edit runs next (one transaction). It marks the invoice as "waiting for QuickBooks".
//   3. QuickBooks gets the new lines with a request id, so a retry after a network failure is not applied
//      twice. Only then is the mark cleared.
// If step 3 fails the Package keeps the mark and the reason; a retry reads QuickBooks again and either
// sends the lines or, if QuickBooks already has them, only clears the mark.

import {
  type CreatedQuickbooksInvoice,
  QuickbooksApiError,
  type QuickbooksApiOptions,
  type QuickbooksEnvironment,
  type QuickbooksInvoiceSnapshot,
} from './quickbooksApi.ts'
import {
  buildQuickbooksInvoicePayload,
  QuickbooksInvoiceError,
  type QuickbooksInvoicePayload,
} from './quickbooksInvoice.ts'
import { differenceProblem, type InvoiceDifference, readInvoiceDifference } from './quickbooksInvoiceDifference.ts'
import { mapPackageToCharges } from './quickbooksPackageCharges.ts'
import type { LoadedPackage } from './quickbooksPackageSource.ts'
import type { QuickbooksSession } from './quickbooksSession.ts'

export type InvoiceUpdateErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_CREATED'
  | 'NOTHING_PENDING'
  | 'UPDATE_PENDING'
  | 'WRONG_COMPANY'
  | 'MISSING_IN_QUICKBOOKS'
  | 'VOIDED_IN_QUICKBOOKS'
  | 'HAS_PAYMENTS'
  | 'EDITED_IN_QUICKBOOKS'
  | 'TOTAL_MISMATCH'
  | 'DIFFERENCE_TOO_LARGE'
  | 'EDIT_REFUSED'

export class QuickbooksInvoiceUpdateError extends Error {
  readonly code: InvoiceUpdateErrorCode

  constructor(code: InvoiceUpdateErrorCode, message: string) {
    super(message)
    this.name = 'QuickbooksInvoiceUpdateError'
    this.code = code
  }
}

export type InvoiceUpdateAction = 'preview' | 'apply' | 'retry'

/** The cells, Hardware lines and Options the Package keeps, as the edit function receives them. */
export interface PackageEditRequest {
  selections: { lot_id: number; draw_number: number }[]
  hardwareSelections: { lot_id: number; event_type: string }[]
  /** Option units to take off the Package. */
  releasedOptions: { lot_id: number; option_id: number; unit_no: number }[]
  /** Free Option units to put on the Package. */
  addedOptions: { lot_id: number; option_id: number; unit_no: number }[]
  reason: string
  notes: string | null
}

export interface EditFigures {
  gross: number
  retention: number
  wrap: number
  net: number
  cells: number
  hardware_lines: number
  options: number
}

/** What the database edit did (or, on a preview, would do). */
export interface PackageEditResult {
  package_id: number
  package_number: string
  invoice_number: string
  qbo_invoice_id: string
  dry_run: boolean
  previous: EditFigures
  next: EditFigures
  removed_cells: unknown[]
  added_cells: unknown[]
  released_options: unknown[]
  added_options: unknown[]
  removed_hardware: unknown[]
  added_hardware: unknown[]
  removed_documents: unknown[]
  removed_storage_paths: string[]
  /** The emails in which the Package was sent to the Builder. */
  sent: { sent_at: string; destination: string | null }[]
}

/** What setting the difference line of an invoiced Package did (or, on a preview, would do). */
export interface DifferenceChangeResult {
  package_id: number
  package_number: string
  invoice_number: string
  qbo_invoice_id: string
  dry_run: boolean
  net: number
  limit: number
  previous: { description: string; amount: number; limit: number } | null
  next: { description: string; amount: number; limit: number } | null
  previous_total: number
  next_total: number
  removed_documents: unknown[]
  removed_storage_paths: string[]
  sent: { sent_at: string; destination: string | null }[]
}

/** A change to the difference line only: the new line, or null to take it off. */
export interface DifferenceChange {
  difference: InvoiceDifference | null
}

export interface InvoiceUpdateContext {
  packageNumber: string
  quickbooksStatus: string
  invoiceId: string | null
  docNumber: string | null
  environment: string | null
  realmId: string | null
  /** The total QuickBooks was last told. */
  totalAmount: number | null
  /** The invoice as it was last sent. */
  payload: QuickbooksInvoicePayload | null
  /** The manual difference line the invoice carries, which stays on it through every edit. */
  difference: InvoiceDifference | null
  updatePending: boolean
  updateRequestId: string | null
}

export interface InvoiceUpdateDeps {
  loadContext(packageId: number): Promise<InvoiceUpdateContext>
  /** Opens the session of the environment the invoice was created in. */
  openSession(environment: QuickbooksEnvironment): Promise<QuickbooksSession>
  readInvoice(api: QuickbooksApiOptions, invoiceId: string): Promise<QuickbooksInvoiceSnapshot | null>
  /** Runs the database edit; a dry run changes nothing. */
  applyEdit(packageId: number, request: PackageEditRequest, dryRun: boolean): Promise<PackageEditResult>
  /** Saves the new difference line of the invoice (or takes it off); a dry run changes nothing. */
  applyDifference(
    packageId: number,
    difference: InvoiceDifference | null,
    dryRun: boolean,
  ): Promise<DifferenceChangeResult>
  removeStoredFile(path: string): Promise<void>
  loadPackage(packageId: number): Promise<LoadedPackage>
  updateInvoice(
    api: QuickbooksApiOptions,
    invoice: Record<string, unknown>,
    requestId: string,
  ): Promise<CreatedQuickbooksInvoice>
  /** Clears the "waiting for QuickBooks" mark and records the new token, total and lines. */
  complete(
    packageId: number,
    updated: { syncToken: string | null; totalAmount: number },
    payload: QuickbooksInvoicePayload,
  ): Promise<void>
  fail(packageId: number, message: string, requestReusable: boolean): Promise<void>
  saveInvoicePdf(
    api: QuickbooksApiOptions,
    input: { packageId: number; invoiceId: string; documentNumber: string },
  ): Promise<void>
}

export type InvoiceUpdateResult =
  | {
    action: 'preview'
    /** Set when the Package would be edited; null when only the difference line changes. */
    edit: PackageEditResult | null
    difference: DifferenceChangeResult | null
    warnings: string[]
  }
  | {
    action: 'apply' | 'retry'
    /** What the database edit did; a retry has none, the edit was made earlier. */
    edit: PackageEditResult | null
    /** What changing the difference line did, when that was the change. */
    difference: DifferenceChangeResult | null
    invoiceId: string
    docNumber: string | null
    totalAmount: number
    /** QuickBooks already had the new lines (an earlier try got through); nothing was sent again. */
    alreadyInQuickbooks: boolean
    warnings: string[]
  }

const cents = (amount: number) => Math.round(amount * 100)
const squeeze = (text: string) => text.replace(/\s+/gu, ' ').trim()

const EVENT_TYPES = ['EXT', 'DM', 'HW']

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

/** Checks the body of the request; anything wrong is reported before the database is touched. */
export function parseEditRequest(body: unknown): PackageEditRequest {
  const fail = (message: string): never => {
    throw new QuickbooksInvoiceUpdateError('INVALID_REQUEST', message)
  }
  const record = (body ?? {}) as Record<string, unknown>

  const list = (value: unknown, name: string): unknown[] => {
    if (value == null) return []
    if (!Array.isArray(value)) return fail(`${name} must be a list.`)
    return value
  }

  const selections = list(record.selections, 'selections').map((entry) => {
    const item = entry as { lot_id?: unknown; draw_number?: unknown }
    if (!isPositiveInteger(item?.lot_id) || !isPositiveInteger(item.draw_number)) {
      return fail('Every cell needs a lot_id and a draw_number.')
    }
    return { lot_id: item.lot_id, draw_number: item.draw_number }
  })

  const hardwareSelections = list(record.hardwareSelections, 'hardwareSelections').map((entry) => {
    const item = entry as { lot_id?: unknown; event_type?: unknown }
    if (!isPositiveInteger(item?.lot_id) || typeof item.event_type !== 'string' || !EVENT_TYPES.includes(item.event_type)) {
      return fail('Every Separate Hardware line needs a lot_id and an event_type of EXT, DM or HW.')
    }
    return { lot_id: item.lot_id, event_type: item.event_type }
  })

  const releasedOptions = list(record.releasedOptions, 'releasedOptions').map((entry) => {
    const item = entry as { lot_id?: unknown; option_id?: unknown; unit_no?: unknown }
    if (!isPositiveInteger(item?.lot_id) || !isPositiveInteger(item.option_id) || !isPositiveInteger(item.unit_no)) {
      return fail('Every released Option needs a lot_id, an option_id and a unit_no.')
    }
    return { lot_id: item.lot_id, option_id: item.option_id, unit_no: item.unit_no }
  })

  const addedOptions = list(record.addedOptions, 'addedOptions').map((entry) => {
    const item = entry as { lot_id?: unknown; option_id?: unknown; unit_no?: unknown }
    if (!isPositiveInteger(item?.lot_id) || !isPositiveInteger(item.option_id) || !isPositiveInteger(item.unit_no)) {
      return fail('Every added Option needs a lot_id, an option_id and a unit_no.')
    }
    return { lot_id: item.lot_id, option_id: item.option_id, unit_no: item.unit_no }
  })

  if (selections.length + hardwareSelections.length === 0) {
    fail('A Package must keep at least one Lot / Draw cell or Separate Hardware line. To bill nothing, void the invoice instead.')
  }

  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  if (!reason || reason.length > 500) fail('Enter a correction reason of 500 characters or fewer.')

  let notes: string | null = null
  if (record.notes != null) {
    if (typeof record.notes !== 'string' || record.notes.trim().length > 500) {
      fail('Notes must be 500 characters or fewer.')
    }
    notes = (record.notes as string).trim() || null
  }

  return { selections, hardwareSelections, releasedOptions, addedOptions, reason, notes }
}

/**
 * The body of a request that only changes the difference line: `difference` is `{ description, amount }`
 * to add or change it, or null to take it off. Returns null when the body is not about the difference.
 */
export function parseDifferenceRequest(body: unknown): DifferenceChange | null {
  const record = (body ?? {}) as Record<string, unknown>
  if (!('difference' in record) || record.selections !== undefined) return null

  const read = readInvoiceDifference(record.difference)
  if (read.problem) throw new QuickbooksInvoiceUpdateError('INVALID_REQUEST', read.problem)
  const { difference } = read
  if (difference) {
    // The limit depends on the Package net, which the database knows; everything else is checked here.
    const problem = differenceProblem(difference, 1_000_000_000)
    if (problem) throw new QuickbooksInvoiceUpdateError('INVALID_REQUEST', problem.message)
  }
  return { difference }
}

const environmentOf = (value: string | null): QuickbooksEnvironment | null =>
  value === 'sandbox' || value === 'production' ? value : null

/** A line in a form that two spellings of the same line share. */
const lineKey = (line: { description: string; amount: number }) =>
  `${cents(line.amount)}|${squeeze(line.description)}`

function sameLines(
  left: { description: string; amount: number }[],
  right: { description: string; amount: number }[],
) {
  if (left.length !== right.length) return false
  const sorted = (lines: typeof left) => lines.map(lineKey).sort()
  const a = sorted(left)
  const b = sorted(right)
  return a.every((key, index) => key === b[index])
}

const storedLines = (payload: QuickbooksInvoicePayload | null) =>
  (payload?.Line ?? []).map((line) => ({ description: line.Description, amount: line.Amount }))

function describeFailure(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The difference line stays on the invoice through an edit, so it has to fit the limit for the size the
 * invoice will have. This runs before anything is saved: a Package must never be edited into a state its
 * invoice cannot follow.
 */
function checkDifferenceStillFits(difference: InvoiceDifference | null, newNet: number) {
  if (!difference) return
  const problem = differenceProblem(difference, newNet)
  if (!problem) return
  throw new QuickbooksInvoiceUpdateError(
    'DIFFERENCE_TOO_LARGE',
    problem.code === 'TOO_LARGE'
      ? `${problem.message} The invoice keeps its "${difference.description}" line, so this change cannot be made. `
        + 'Void the invoice and create it again, or keep the Package total within that limit.'
      : problem.message,
  )
}

/** The invoice as QuickBooks has it, checked against what this Package says it should be. */
function checkLiveInvoice(
  snapshot: QuickbooksInvoiceSnapshot,
  context: InvoiceUpdateContext,
  { expectOld }: { expectOld: boolean },
) {
  const live = snapshot.detail

  if (cents(live.totalAmount) === 0 && cents(context.totalAmount ?? 1) > 0) {
    throw new QuickbooksInvoiceUpdateError(
      'VOIDED_IN_QUICKBOOKS',
      'This invoice was voided in QuickBooks, so it cannot be edited. Void it here too and create a new one.',
    )
  }
  if (live.linkedTransactions.length > 0 || cents(live.balance) !== cents(live.totalAmount)) {
    throw new QuickbooksInvoiceUpdateError(
      'HAS_PAYMENTS',
      'The invoice already has a payment or credit applied in QuickBooks, so it cannot be edited here.',
    )
  }

  if (!expectOld) return

  const sameTotal = context.totalAmount == null || cents(live.totalAmount) === cents(context.totalAmount)
  const sameBody = context.payload == null || sameLines(snapshot.lines, storedLines(context.payload))
  if (!sameTotal || !sameBody) {
    throw new QuickbooksInvoiceUpdateError(
      'EDITED_IN_QUICKBOOKS',
      'The invoice was changed in QuickBooks after it was sent from here. Check it there before editing the Package.',
    )
  }
}

export async function updatePackageInvoice(
  deps: InvoiceUpdateDeps,
  { packageId, action, edit, differenceChange }: {
    packageId: number
    action: InvoiceUpdateAction
    /** Required for a preview and an apply, unless only the difference changes; a retry sends what the database already holds. */
    edit?: PackageEditRequest
    /** Instead of an edit: only the difference line of the invoice changes. */
    differenceChange?: DifferenceChange
  },
): Promise<InvoiceUpdateResult> {
  const context = await deps.loadContext(packageId)
  const environment = environmentOf(context.environment)

  if (context.quickbooksStatus !== 'CREATED' || !context.invoiceId || !environment) {
    throw new QuickbooksInvoiceUpdateError('NOT_CREATED', 'This Package has no QuickBooks invoice to update.')
  }
  if (action === 'retry' && !context.updatePending) {
    throw new QuickbooksInvoiceUpdateError('NOTHING_PENDING', 'This invoice has no change waiting for QuickBooks.')
  }
  if (action !== 'retry' && context.updatePending) {
    throw new QuickbooksInvoiceUpdateError(
      'UPDATE_PENDING',
      'The last change to this Package has not reached QuickBooks yet. Send it again first.',
    )
  }
  if (action !== 'retry' && !edit && !differenceChange) {
    throw new QuickbooksInvoiceUpdateError('INVALID_REQUEST', 'Say which cells, Hardware lines and Options the Package keeps.')
  }
  if (edit && differenceChange) {
    throw new QuickbooksInvoiceUpdateError('INVALID_REQUEST', 'Change the Package or its difference line, not both at once.')
  }
  // The difference line the invoice has after this change: the new one, or the one it carries.
  const difference: InvoiceDifference | null = differenceChange ? differenceChange.difference : context.difference

  const session = await deps.openSession(environment)
  if (session.environment !== context.environment || session.realmId !== context.realmId) {
    throw new QuickbooksInvoiceUpdateError(
      'WRONG_COMPANY',
      'QuickBooks is connected to a different company than the one this invoice was created in.',
    )
  }
  const api: QuickbooksApiOptions = {
    environment: session.environment,
    realmId: session.realmId,
    accessToken: session.accessToken,
  }

  const snapshot = await deps.readInvoice(api, context.invoiceId)
  if (!snapshot) {
    throw new QuickbooksInvoiceUpdateError(
      'MISSING_IN_QUICKBOOKS',
      'QuickBooks no longer has this invoice (it was deleted there), so it cannot be updated.',
    )
  }

  // A preview and a first apply expect the invoice exactly as we sent it. A retry expects either that or,
  // if the lines already went through, the new lines.
  checkLiveInvoice(snapshot, context, { expectOld: action !== 'retry' })

  if (action === 'preview') {
    if (differenceChange) {
      const preview = await deps.applyDifference(packageId, differenceChange.difference, true)
      return { action, edit: null, difference: preview, warnings: [] }
    }
    const preview = await deps.applyEdit(packageId, edit as PackageEditRequest, true)
    checkDifferenceStillFits(context.difference, Number(preview.next.net))
    return { action, edit: preview, difference: null, warnings: [] }
  }

  let result: PackageEditResult | null = null
  let differenceResult: DifferenceChangeResult | null = null
  const warnings: string[] = []

  if (action === 'apply' && differenceChange) {
    // The database checks the limit against the Package net and keeps the new line; the Release goes.
    differenceResult = await deps.applyDifference(packageId, differenceChange.difference, false)
    for (const path of differenceResult.removed_storage_paths) {
      await deps.removeStoredFile(path).catch(() => {})
    }
  } else if (action === 'apply') {
    // Look first (nothing is kept): the edit must not be saved if the invoice's difference line would
    // no longer fit.
    if (context.difference) {
      const dryRun = await deps.applyEdit(packageId, edit as PackageEditRequest, true)
      checkDifferenceStillFits(context.difference, Number(dryRun.next.net))
    }
    result = await deps.applyEdit(packageId, edit as PackageEditRequest, false)
    // The Release and Payment Schedule files were deleted from the database; their bytes go too.
    for (const path of result.removed_storage_paths) {
      await deps.removeStoredFile(path).catch(() => {})
    }
  }

  // What the invoice has to say now, from the Package as the database holds it.
  let built: QuickbooksInvoicePayload
  // What QuickBooks has to total: the Package net, plus the manual difference line the invoice carries.
  let expectedNet: number
  try {
    const loaded = await deps.loadPackage(packageId)
    const mapped = mapPackageToCharges(loaded.source)
    expectedNet = mapped.expectedNetAmount + (difference?.amount ?? 0)

    const customerId = (snapshot.raw.CustomerRef as { value?: unknown } | undefined)?.value
    const itemId = snapshot.lines.find((line) => line.itemId)?.itemId
      ?? context.payload?.Line[0]?.SalesItemLineDetail.ItemRef.value
      ?? session.itemId
    if (typeof customerId !== 'string' || !itemId) {
      throw new QuickbooksInvoiceError(
        'INVALID_INPUT',
        'The invoice in QuickBooks has no customer or product to build the new lines on.',
      )
    }
    built = buildQuickbooksInvoicePayload({
      customerId,
      itemId,
      txnDate: typeof snapshot.raw.TxnDate === 'string'
        ? snapshot.raw.TxnDate
        : (context.payload?.TxnDate ?? new Date().toISOString().slice(0, 10)),
      ...mapped,
      difference,
    })
  } catch (error) {
    await deps.fail(packageId, describeFailure(error), true).catch(() => {})
    throw error
  }

  // The payload we keep: the invoice as it was sent, with the new lines.
  const stored: QuickbooksInvoicePayload = context.payload
    ? { ...context.payload, Line: built.Line }
    : built

  const finish = async (
    updated: { syncToken: string | null; totalAmount: number },
    alreadyInQuickbooks: boolean,
  ): Promise<InvoiceUpdateResult> => {
    await deps.complete(packageId, updated, stored)

    // The invoice is the money record and is already saved: a PDF that cannot be stored is reported.
    try {
      await deps.saveInvoicePdf(api, {
        packageId,
        invoiceId: context.invoiceId as string,
        documentNumber: snapshot.detail.docNumber ?? context.docNumber ?? context.packageNumber,
      })
    } catch (error) {
      warnings.push(
        `The invoice was updated, but its PDF could not be saved: ${describeFailure(error)} `
          + 'Use "Save PDF" on the Package to try again.',
      )
    }

    return {
      action,
      edit: result,
      difference: differenceResult,
      invoiceId: context.invoiceId as string,
      docNumber: snapshot.detail.docNumber,
      totalAmount: updated.totalAmount,
      alreadyInQuickbooks,
      warnings,
    }
  }

  // A retry after the lines already reached QuickBooks (the answer was lost, or saving it failed).
  if (action === 'retry' && cents(snapshot.detail.totalAmount) === cents(expectedNet) && sameLines(
    snapshot.lines,
    built.Line.map((line) => ({ description: line.Description, amount: line.Amount })),
  )) {
    return await finish({ syncToken: snapshot.detail.syncToken, totalAmount: snapshot.detail.totalAmount }, true)
  }
  if (action === 'retry') {
    checkLiveInvoice(snapshot, context, { expectOld: true })
  }

  // The request id the edit (or the last refusal) left, so QuickBooks tells a retry from a new change.
  const fresh = action === 'apply' ? await deps.loadContext(packageId) : context
  if (!fresh.updateRequestId) {
    throw new QuickbooksInvoiceUpdateError('NOTHING_PENDING', 'This invoice has no change waiting for QuickBooks.')
  }

  let updated: CreatedQuickbooksInvoice
  try {
    // A full update: the invoice as QuickBooks has it (with its current SyncToken) and the new lines.
    updated = await deps.updateInvoice(api, { ...snapshot.raw, Line: built.Line }, fresh.updateRequestId)
  } catch (error) {
    const definite = error instanceof QuickbooksApiError ? error.definite : false
    await deps.fail(packageId, describeFailure(error), !definite).catch(() => {})
    throw error
  }

  if (updated.totalAmount == null || cents(updated.totalAmount) !== cents(expectedNet)) {
    const message = `QuickBooks answered with a total of ${updated.totalAmount?.toFixed(2) ?? 'nothing'} `
      + `but the Package${difference ? ' with its difference' : ''} is ${expectedNet.toFixed(2)}. `
      + 'Check the invoice in QuickBooks.'
    await deps.fail(packageId, message, true).catch(() => {})
    throw new QuickbooksInvoiceUpdateError('TOTAL_MISMATCH', message)
  }

  return await finish({ syncToken: updated.syncToken, totalAmount: updated.totalAmount }, false)
}
