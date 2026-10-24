import { assertEquals, assertRejects } from '@std/assert'
import {
  type InvoicePdfActionDeps,
  invoicePdfFileName,
  MAX_INVOICE_PDF_BYTES,
  type PdfStoreDeps,
  QuickbooksInvoicePdfError,
  saveInvoicePdfForPackage,
  storeInvoicePdf,
} from './quickbooksInvoicePdf.ts'

const api = { environment: 'sandbox', realmId: '9341', accessToken: 'tok' } as const
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
const ID = '11111111-1111-4111-8111-111111111111'

function storeHarness(overrides: Partial<PdfStoreDeps> = {}) {
  const calls: string[] = []
  const registered: Record<string, unknown>[] = []
  const deps: PdfStoreDeps = {
    fetchPdf: (_api, invoiceId) => {
      calls.push(`fetch:${invoiceId}`)
      return Promise.resolve(pdf)
    },
    upload: (path, bytes) => {
      calls.push(`upload:${path}:${bytes.length}`)
      return Promise.resolve()
    },
    register: (input) => {
      calls.push('register')
      registered.push(input)
      return Promise.resolve({ replacedStoragePath: null })
    },
    removeStoredFile: (path) => {
      calls.push(`remove:${path}`)
      return Promise.resolve()
    },
    newId: () => ID,
    ...overrides,
  }
  return { deps, calls, registered }
}

const store = (deps: PdfStoreDeps) =>
  storeInvoicePdf(deps, { api, packageId: 29, invoiceId: '146', documentNumber: 'DP-00000029' })

Deno.test('names the file after the invoice and strips characters a file name cannot hold', () => {
  assertEquals(invoicePdfFileName('DP-00000029'), 'Invoice - DP-00000029.pdf')
  assertEquals(invoicePdfFileName('A/B:C*D'), 'Invoice - A B C D.pdf')
  assertEquals(invoicePdfFileName('  '), 'Invoice - QuickBooks.pdf')
})

Deno.test('downloads, uploads under the Package invoice folder and registers with size and checksum', async () => {
  const { deps, calls, registered } = storeHarness()

  const stored = await store(deps)

  assertEquals(stored, { fileName: 'Invoice - DP-00000029.pdf', sizeBytes: 8 })
  assertEquals(calls, ['fetch:146', `upload:29/invoice/${ID}.pdf:8`, 'register'])
  assertEquals(registered[0].storagePath, `29/invoice/${ID}.pdf`)
  assertEquals(registered[0].sizeBytes, 8)
  assertEquals(/^[0-9a-f]{64}$/u.test(String(registered[0].sha256)), true)
})

Deno.test('deletes the file it replaced once the new one is registered', async () => {
  const { deps, calls } = storeHarness({
    register: () => Promise.resolve({ replacedStoragePath: '29/invoice/old.pdf' }),
  })

  await store(deps)

  assertEquals(calls.at(-1), 'remove:29/invoice/old.pdf')
})

Deno.test('a failed registration removes the file it just uploaded and reports the error', async () => {
  const { deps, calls } = storeHarness({ register: () => Promise.reject(new Error('The Package has no QuickBooks invoice to save')) })

  await assertRejects(() => store(deps), Error, 'no QuickBooks invoice to save')

  assertEquals(calls.at(-1), `remove:29/invoice/${ID}.pdf`)
})

Deno.test('a PDF that is too large is refused before anything is uploaded', async () => {
  const { deps, calls } = storeHarness({
    fetchPdf: () => Promise.resolve(new Uint8Array(MAX_INVOICE_PDF_BYTES + 1)),
  })

  const error = await assertRejects(() => store(deps), QuickbooksInvoicePdfError)

  assertEquals(error.code, 'TOO_LARGE')
  assertEquals(calls.some((call) => call.startsWith('upload')), false)
})

function actionHarness(context: Record<string, unknown> = {}) {
  const base = storeHarness()
  const deps: InvoicePdfActionDeps = {
    ...base.deps,
    loadContext: () =>
      Promise.resolve({
        packageNumber: 'DP-00000029',
        quickbooksStatus: 'CREATED',
        invoiceId: '146',
        docNumber: 'DP-00000029',
        environment: 'sandbox',
        realmId: '9341',
        ...context,
      }),
    openSession: () => {
      base.calls.push('openSession')
      return Promise.resolve({ environment: 'sandbox', realmId: '9341', itemId: '19', accessToken: 'tok' })
    },
  }
  return { deps, calls: base.calls }
}

Deno.test('saves the PDF of an existing invoice on demand', async () => {
  const { deps, calls } = actionHarness()

  const stored = await saveInvoicePdfForPackage(deps, 29)

  assertEquals(stored.fileName, 'Invoice - DP-00000029.pdf')
  assertEquals(calls[0], 'openSession')
})

Deno.test('on demand, refuses a Package with no created invoice or another QuickBooks company', async () => {
  const none = actionHarness({ quickbooksStatus: 'VOIDED' })
  const notCreated = await assertRejects(() => saveInvoicePdfForPackage(none.deps, 29), QuickbooksInvoicePdfError)
  assertEquals(notCreated.code, 'NOT_CREATED')
  assertEquals(none.calls, [])

  const other = actionHarness({ realmId: '1111' })
  const wrong = await assertRejects(() => saveInvoicePdfForPackage(other.deps, 29), QuickbooksInvoicePdfError)
  assertEquals(wrong.code, 'WRONG_COMPANY')
  assertEquals(other.calls.some((call) => call.startsWith('fetch')), false)
})
