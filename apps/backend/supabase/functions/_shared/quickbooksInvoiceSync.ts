// Creates the QuickBooks invoice of one Package.
//
// Every side effect is injected so the order of operations -- the part that
// protects against duplicate invoices -- can be tested without QuickBooks or a
// database. Rules this enforces:
//   * nothing leaves the server before the lines add up to the Package net,
//   * the Package is claimed (locked) before QuickBooks is called,
//   * a failure always releases the claim and records why,
//   * if the invoice was created but could not be recorded, the claim keeps its
//     request id so a retry gets the same invoice back instead of a second one.

import {
  createQuickbooksInvoice,
  type CreatedQuickbooksInvoice,
  findQuickbooksCustomers,
  QuickbooksApiError,
  type QuickbooksApiOptions,
  type QuickbooksCustomer,
} from './quickbooksApi.ts'
import {
  type ResolvedQuickbooksCustomer,
  resolveBuilderCustomer,
} from './quickbooksCustomer.ts'
import {
  buildQuickbooksInvoicePayload,
  dueDateFor,
  QuickbooksInvoiceError,
  type QuickbooksInvoicePayload,
} from './quickbooksInvoice.ts'
import { mapPackageToCharges } from './quickbooksPackageCharges.ts'
import type { LoadedPackage } from './quickbooksPackageSource.ts'
import type { QuickbooksSession } from './quickbooksSession.ts'

export type SyncConflictReason = 'VOIDED' | 'ALREADY_CREATED' | 'IN_PROGRESS'

export class QuickbooksSyncConflictError extends Error {
  readonly reason: SyncConflictReason

  constructor(reason: SyncConflictReason) {
    super(
      reason === 'IN_PROGRESS'
        ? 'Another QuickBooks invoice attempt for this Package is still running. Try again in a few minutes.'
        : reason === 'VOIDED'
        ? 'A voided Package cannot be invoiced.'
        : 'This Package already has a QuickBooks invoice.',
    )
    this.name = 'QuickbooksSyncConflictError'
    this.reason = reason
  }
}

export type ClaimResult =
  | { claimed: true; requestId: string }
  | { claimed: false; reason: SyncConflictReason }

export interface InvoiceSyncDeps {
  loadPackage(packageId: number): Promise<LoadedPackage>
  openSession(): Promise<QuickbooksSession>
  getCustomerMapping(
    builderId: number,
    environment: string,
  ): Promise<{ customerId: string; displayName: string | null } | null>
  saveCustomerMapping(
    builderId: number,
    environment: string,
    customer: { customerId: string; displayName: string },
  ): Promise<void>
  searchCustomers(api: QuickbooksApiOptions, name: string): Promise<QuickbooksCustomer[]>
  claim(packageId: number, environment: string, realmId: string): Promise<ClaimResult>
  createInvoice(
    api: QuickbooksApiOptions,
    payload: QuickbooksInvoicePayload,
    requestId: string,
  ): Promise<CreatedQuickbooksInvoice>
  complete(
    packageId: number,
    created: CreatedQuickbooksInvoice,
    payload: QuickbooksInvoicePayload,
  ): Promise<void>
  fail(packageId: number, message: string, requestReusable: boolean): Promise<void>
}

export type CreatePackageInvoiceResult =
  | {
    dryRun: true
    customer: ResolvedQuickbooksCustomer
    invoice: QuickbooksInvoicePayload
  }
  | {
    dryRun: false
    invoiceId: string
    docNumber: string | null
    totalAmount: number | null
    customer: ResolvedQuickbooksCustomer
  }

export function realDeps(
  base: Pick<
    InvoiceSyncDeps,
    | 'loadPackage'
    | 'openSession'
    | 'getCustomerMapping'
    | 'saveCustomerMapping'
    | 'claim'
    | 'complete'
    | 'fail'
  >,
): InvoiceSyncDeps {
  return {
    ...base,
    searchCustomers: (api, name) => findQuickbooksCustomers(api, name),
    createInvoice: (api, payload, requestId) => createQuickbooksInvoice(api, payload, requestId),
  }
}

export async function createPackageInvoice(
  deps: InvoiceSyncDeps,
  { packageId, txnDate, dryRun }: { packageId: number; txnDate: string; dryRun: boolean },
): Promise<CreatePackageInvoiceResult> {
  const loaded = await deps.loadPackage(packageId)
  if (loaded.quickbooksStatus === 'CREATED') {
    throw new QuickbooksSyncConflictError('ALREADY_CREATED')
  }

  // Validates package type, status and totals before QuickBooks is contacted.
  const mapped = mapPackageToCharges(loaded.source)

  const session = await deps.openSession()
  if (!session.itemId) {
    throw new QuickbooksInvoiceError(
      'PRODUCT_MISSING',
      'The QuickBooks Product "Material Installation & Supply" was not found. Create it and reconnect QuickBooks.',
    )
  }

  const api: QuickbooksApiOptions = {
    environment: session.environment,
    realmId: session.realmId,
    accessToken: session.accessToken,
  }

  const customer = await resolveBuilderCustomer({
    builderName: loaded.builder.name,
    mapping: await deps.getCustomerMapping(loaded.builder.id, session.environment),
    search: (name) => deps.searchCustomers(api, name),
  })

  const payload = buildQuickbooksInvoicePayload({
    customerId: customer.customerId,
    itemId: session.itemId,
    txnDate,
    dueDate: dueDateFor(txnDate, loaded.paymentTermsDays),
    docNumber: loaded.packageNumber,
    privateNote: `ValtrimBilling ${loaded.packageNumber}`,
    ...mapped,
  })

  if (dryRun) return { dryRun: true, customer, invoice: payload }

  if (customer.source === 'quickbooks') {
    await deps.saveCustomerMapping(loaded.builder.id, session.environment, {
      customerId: customer.customerId,
      displayName: customer.displayName,
    })
  }

  const claim = await deps.claim(packageId, session.environment, session.realmId)
  if (!claim.claimed) throw new QuickbooksSyncConflictError(claim.reason)

  let created: CreatedQuickbooksInvoice
  try {
    created = await deps.createInvoice(api, payload, claim.requestId)
  } catch (error) {
    const definite = error instanceof QuickbooksApiError ? error.definite : false
    await deps.fail(packageId, (error as Error).message, !definite)
    throw error
  }

  try {
    await deps.complete(packageId, created, payload)
  } catch (error) {
    // The invoice exists in QuickBooks; keep the request id so a retry gets it back.
    await deps.fail(
      packageId,
      `QuickBooks created invoice ${created.id}, but saving it failed: ${(error as Error).message}`,
      true,
    )
    throw error
  }

  return {
    dryRun: false,
    invoiceId: created.id,
    docNumber: created.docNumber,
    totalAmount: created.totalAmount,
    customer,
  }
}
