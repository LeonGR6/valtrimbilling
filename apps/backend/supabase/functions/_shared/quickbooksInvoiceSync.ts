// Creates the QuickBooks invoice of one Package.
//
// Every side effect is injected so the order of operations -- the part that
// protects against duplicate invoices -- can be tested without QuickBooks or a
// database. Rules this enforces:
//   * the environment (Test or Production) is given, never guessed: it is where
//     the invoice goes, and the caller took it from the platform setting,
//   * nothing leaves the server before the lines add up to the Package net,
//   * the invoice number is typed by a person and must be unused in that
//     environment, in the database and in QuickBooks,
//   * the Package is claimed (locked) before QuickBooks is called,
//   * a failure always releases the claim and records why,
//   * if the invoice was created but could not be recorded, the claim keeps its
//     request id so a retry gets the same invoice back instead of a second one.

import {
  createQuickbooksInvoice,
  type CreatedQuickbooksInvoice,
  fetchQuickbooksCustomFieldDefinitions,
  findQuickbooksCustomers,
  findQuickbooksInvoiceByDocNumber,
  getQuickbooksCustomer,
  QuickbooksApiError,
  type QuickbooksApiOptions,
  type QuickbooksCustomer,
  type QuickbooksCustomerDetail,
  type QuickbooksEnvironment,
} from './quickbooksApi.ts'
import { type CustomFieldDefinition, matchJobCustomFields } from './quickbooksCustomFields.ts'
import {
  type ResolvedQuickbooksCustomer,
  resolveBuilderCustomer,
} from './quickbooksCustomer.ts'
import { ENVIRONMENT_LABELS } from './quickbooksEnvironment.ts'
import {
  buildQuickbooksInvoicePayload,
  dueDateFor,
  parseInvoiceNumber,
  QuickbooksInvoiceError,
  type QuickbooksInvoicePayload,
} from './quickbooksInvoice.ts'
import { mapPackageToCharges } from './quickbooksPackageCharges.ts'
import type { LoadedPackage } from './quickbooksPackageSource.ts'
import type { QuickbooksSession } from './quickbooksSession.ts'

export type SyncConflictReason =
  | 'VOIDED'
  | 'ALREADY_CREATED'
  | 'IN_PROGRESS'
  | 'NUMBER_IN_USE'
  | 'OTHER_ENVIRONMENT'

export class QuickbooksSyncConflictError extends Error {
  readonly reason: SyncConflictReason

  constructor(reason: SyncConflictReason, environment: string | null = null) {
    const other = environment === 'production' ? 'Production' : environment === 'sandbox' ? 'Test' : 'the other mode'
    super(
      reason === 'IN_PROGRESS'
        ? 'Another QuickBooks invoice attempt for this Package is still running. Try again in a few minutes.'
        : reason === 'VOIDED'
        ? 'A voided Package cannot be invoiced.'
        : reason === 'NUMBER_IN_USE'
        ? 'That invoice number is already used by another Package in this mode. Choose another one.'
        : reason === 'OTHER_ENVIRONMENT'
        ? `An earlier attempt for this Package may have reached QuickBooks ${other}. `
          + `Switch to ${other}, finish or void it there, then try again.`
        : 'This Package already has a QuickBooks invoice.',
    )
    this.name = 'QuickbooksSyncConflictError'
    this.reason = reason
  }
}

export type ClaimResult =
  | { claimed: true; requestId: string; invoiceNumber: string }
  | { claimed: false; reason: SyncConflictReason; environment?: string }

export interface InvoiceSyncDeps {
  loadPackage(packageId: number): Promise<LoadedPackage>
  openSession(environment: QuickbooksEnvironment): Promise<QuickbooksSession>
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
  /** Whether another Package already uses this invoice number in this environment. */
  isNumberTaken(environment: string, invoiceNumber: string, packageId: number): Promise<boolean>
  /** The highest numeric invoice number used in this environment, for reference. */
  lastInvoiceNumber(environment: string): Promise<string | null>
  /** The QuickBooks invoice that already has this number, if any. */
  findInvoiceByNumber(api: QuickbooksApiOptions, invoiceNumber: string): Promise<{ id: string } | null>
  claim(
    packageId: number,
    environment: string,
    realmId: string,
    invoiceNumber: string,
  ): Promise<ClaimResult>
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

/** What is known about the invoice number the person typed. */
export interface InvoiceNumberCheck {
  /** The number typed, or null when none was. */
  number: string | null
  /** Another Package already uses it in this environment. */
  inDatabase: boolean
  /** QuickBooks already has an invoice with it. */
  inQuickbooks: boolean
  /** The highest numeric number used in this environment. */
  last: string | null
  /** The Package's own number from an earlier attempt in this environment, if any. */
  current: string | null
}

export type CreatePackageInvoiceResult =
  | {
    dryRun: true
    environment: QuickbooksEnvironment
    customer: ResolvedQuickbooksCustomer
    invoice: QuickbooksInvoicePayload
    numberCheck: InvoiceNumberCheck
    /** Things that were left out or changed, e.g. a custom field QuickBooks does not have. */
    warnings: string[]
  }
  | {
    dryRun: false
    environment: QuickbooksEnvironment
    invoiceId: string
    invoiceNumber: string
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
    | 'isNumberTaken'
    | 'lastInvoiceNumber'
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
    findInvoiceByNumber: (api, invoiceNumber) => findQuickbooksInvoiceByDocNumber(api, invoiceNumber),
    createInvoice: (api, payload, requestId) => createQuickbooksInvoice(api, payload, requestId),
  }
}

export async function createPackageInvoice(
  deps: InvoiceSyncDeps,
  { packageId, txnDate, dryRun, environment, invoiceNumber }: {
    packageId: number
    txnDate: string
    dryRun: boolean
    environment: QuickbooksEnvironment
    /** What the person typed; a preview may not have one yet. */
    invoiceNumber?: string | null
  },
): Promise<CreatePackageInvoiceResult> {
  const label = ENVIRONMENT_LABELS[environment]
  const loaded = await deps.loadPackage(packageId)
  if (loaded.quickbooksStatus === 'CREATED') {
    throw new QuickbooksSyncConflictError('ALREADY_CREATED')
  }

  // A real send needs the number; a preview shows what is known without one.
  const typedNumber = dryRun && !invoiceNumber?.trim() ? null : parseInvoiceNumber(invoiceNumber)

  // Validates package type, status and totals before QuickBooks is contacted.
  const mapped = mapPackageToCharges(loaded.source)

  const session = await deps.openSession(environment)
  if (!session.itemId) {
    throw new QuickbooksInvoiceError(
      'PRODUCT_MISSING',
      `The QuickBooks ${label} Product "Material Installation & Supply" was not found. Create it and reconnect QuickBooks.`,
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
  if (loaded.quickbooksEnvironment && loaded.quickbooksEnvironment !== environment) {
    const earlier = ENVIRONMENT_LABELS[loaded.quickbooksEnvironment as QuickbooksEnvironment] ?? 'another mode'
    warnings.push(`This Package was last attempted in QuickBooks ${earlier}; this send goes to ${label}.`)
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

  // The number must be free here and in QuickBooks. The Package's own number from
  // an earlier attempt is not a clash: it is the same invoice being retried.
  const current = loaded.syncEnvironment === environment ? loaded.syncInvoiceNumber : null
  const ownNumber = typedNumber != null && typedNumber === current
  const numberCheck: InvoiceNumberCheck = {
    number: typedNumber,
    inDatabase: typedNumber != null && !ownNumber
      ? await deps.isNumberTaken(environment, typedNumber, packageId)
      : false,
    inQuickbooks: typedNumber != null && !ownNumber
      ? (await deps.findInvoiceByNumber(api, typedNumber)) != null
      : false,
    last: await deps.lastInvoiceNumber(environment),
    current,
  }

  const payload = buildQuickbooksInvoicePayload({
    customerId: customer.customerId,
    itemId: session.itemId,
    txnDate,
    dueDate: dueDateFor(txnDate, loaded.paymentTermsDays),
    docNumber: typedNumber ?? undefined,
    // The Package number stays in the private note so the two can be matched.
    privateNote: `ValtrimBilling ${loaded.packageNumber}`,
    customFields,
    ...mapped,
  })

  if (dryRun) {
    return { dryRun: true, environment, customer, invoice: payload, numberCheck, warnings }
  }

  if (numberCheck.inDatabase) throw new QuickbooksSyncConflictError('NUMBER_IN_USE')
  if (numberCheck.inQuickbooks) {
    throw new QuickbooksInvoiceError(
      'NUMBER_IN_USE',
      `Invoice number ${typedNumber} already exists in QuickBooks ${label}. Choose another number.`,
    )
  }

  if (customer.source === 'quickbooks') {
    await deps.saveCustomerMapping(loaded.builder.id, session.environment, {
      customerId: customer.customerId,
      displayName: customer.displayName,
    })
  }

  const claim = await deps.claim(packageId, session.environment, session.realmId, typedNumber as string)
  if (!claim.claimed) throw new QuickbooksSyncConflictError(claim.reason, claim.environment ?? null)

  // After an attempt that may have reached QuickBooks the number is fixed to the
  // one it used; the claim says which.
  const sendPayload: QuickbooksInvoicePayload = { ...payload, DocNumber: claim.invoiceNumber }

  let created: CreatedQuickbooksInvoice
  try {
    created = await deps.createInvoice(api, sendPayload, claim.requestId)
  } catch (error) {
    const definite = error instanceof QuickbooksApiError ? error.definite : false
    await deps.fail(packageId, (error as Error).message, !definite)
    throw error
  }

  try {
    await deps.complete(packageId, created, sendPayload)
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
      documentNumber: created.docNumber ?? claim.invoiceNumber,
    })
  } catch (error) {
    warnings.push(
      `The invoice was created, but its PDF could not be saved: ${(error as Error).message} `
        + 'Use "Save PDF" on the Package to try again.',
    )
  }

  return {
    dryRun: false,
    environment,
    invoiceId: created.id,
    invoiceNumber: claim.invoiceNumber,
    docNumber: created.docNumber,
    totalAmount: created.totalAmount,
    customer,
    warnings,
  }
}
