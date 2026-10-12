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
  fetchQuickbooksCustomFieldDefinitions,
  findQuickbooksCustomers,
  getQuickbooksCustomer,
  QuickbooksApiError,
  type QuickbooksApiOptions,
  type QuickbooksCustomer,
  type QuickbooksCustomerDetail,
} from './quickbooksApi.ts'
import { type CustomFieldDefinition, matchJobCustomFields } from './quickbooksCustomFields.ts'
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
  clearCustomerMapping(builderId: number, environment: string): Promise<void>
  searchCustomers(api: QuickbooksApiOptions, name: string): Promise<QuickbooksCustomer[]>
  verifyCustomer(api: QuickbooksApiOptions, customerId: string): Promise<QuickbooksCustomerDetail | null>
  getCustomFieldDefinitions(api: QuickbooksApiOptions): Promise<CustomFieldDefinition[]>
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
  /** Saves QuickBooks' own PDF of the new invoice as the Package's INVOICE document. */
  saveInvoicePdf(
    api: QuickbooksApiOptions,
    input: { packageId: number; invoiceId: string; documentNumber: string },
  ): Promise<void>
  fail(packageId: number, message: string, requestReusable: boolean): Promise<void>
}

export type CreatePackageInvoiceResult =
  | {
    dryRun: true
    customer: ResolvedQuickbooksCustomer
    invoice: QuickbooksInvoicePayload
    /** Things that were left out or changed, e.g. a custom field QuickBooks does not have. */
    warnings: string[]
  }
  | {
    dryRun: false
    invoiceId: string
    docNumber: string | null
    totalAmount: number | null
    customer: ResolvedQuickbooksCustomer
    warnings: string[]
  }

export function realDeps(
  base: Pick<
    InvoiceSyncDeps,
    | 'loadPackage'
    | 'openSession'
    | 'getCustomerMapping'
    | 'saveCustomerMapping'
    | 'clearCustomerMapping'
    | 'claim'
    | 'complete'
    | 'saveInvoicePdf'
    | 'fail'
  >,
): InvoiceSyncDeps {
  return {
    ...base,
    searchCustomers: (api, name) => findQuickbooksCustomers(api, name),
    verifyCustomer: (api, customerId) => getQuickbooksCustomer(api, customerId),
    getCustomFieldDefinitions: (api) => fetchQuickbooksCustomFieldDefinitions(api),
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
    verify: (customerId) => deps.verifyCustomer(api, customerId),
    // A preview must not change anything, so only a real send drops a stale mapping.
    clearMapping: () =>
      dryRun
        ? Promise.resolve()
        : deps.clearCustomerMapping(loaded.builder.id, session.environment),
    search: (name) => deps.searchCustomers(api, name),
  })

  const warnings: string[] = []
  if (customer.replacedStale) {
    warnings.push(
      `The QuickBooks Customer saved for ${loaded.builder.name} no longer existed, so it was matched again by name.`,
    )
  }

  // Job Name and Job # are optional extras: a failure reading them never blocks the invoice.
  let customFields: ReturnType<typeof matchJobCustomFields>['fields'] = []
  try {
    const definitions = await deps.getCustomFieldDefinitions(api)
    const matched = matchJobCustomFields(definitions, {
      jobName: loaded.job.community,
      jobNumber: loaded.job.code,
    })
    customFields = matched.fields
    warnings.push(...matched.warnings)
  } catch (error) {
    warnings.push(`The QuickBooks custom fields could not be read: ${(error as Error).message}`)
  }

  const payload = buildQuickbooksInvoicePayload({
    customerId: customer.customerId,
    itemId: session.itemId,
    txnDate,
    dueDate: dueDateFor(txnDate, loaded.paymentTermsDays),
    docNumber: loaded.packageNumber,
    privateNote: `ValtrimBilling ${loaded.packageNumber}`,
    customFields,
    ...mapped,
  })

  if (dryRun) return { dryRun: true, customer, invoice: payload, warnings }

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

  // The invoice is the money record and is already saved: a PDF that cannot be
  // stored is reported, never allowed to undo or fail the invoice.
  try {
    await deps.saveInvoicePdf(api, {
      packageId,
      invoiceId: created.id,
      documentNumber: created.docNumber ?? loaded.packageNumber,
    })
  } catch (error) {
    warnings.push(
      `The invoice was created, but its PDF could not be saved: ${(error as Error).message} `
        + 'Use "Save PDF" on the Package to try again.',
    )
  }

  return {
    dryRun: false,
    invoiceId: created.id,
    docNumber: created.docNumber,
    totalAmount: created.totalAmount,
    customer,
    warnings,
  }
}
