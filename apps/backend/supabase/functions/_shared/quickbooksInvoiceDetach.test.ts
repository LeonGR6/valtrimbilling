import { assertEquals, assertRejects } from '@std/assert'
import { detachVoidedInvoice } from './quickbooksInvoiceDetach.ts'

Deno.test('detachVoidedInvoice detaches the invoice and deletes a leftover PDF', async () => {
  const calls: string[] = []
  const result = await detachVoidedInvoice({
    detach: (id) => {
      calls.push(`detach ${id}`)
      return Promise.resolve({ removedStoragePath: '12/invoice/a.pdf', voidedInvoiceNumber: '16002' })
    },
    removeStoredFile: (path) => {
      calls.push(`remove ${path}`)
      return Promise.resolve()
    },
  }, 12)

  assertEquals(result, { detached: true, voidedInvoiceNumber: '16002', removedPdf: true })
  assertEquals(calls, ['detach 12', 'remove 12/invoice/a.pdf'])
})

Deno.test('detachVoidedInvoice has nothing to delete when no PDF was left', async () => {
  const result = await detachVoidedInvoice({
    detach: () => Promise.resolve({ removedStoragePath: null, voidedInvoiceNumber: '14880' }),
    removeStoredFile: () => Promise.reject(new Error('must not be called')),
  }, 3)

  assertEquals(result, { detached: true, voidedInvoiceNumber: '14880', removedPdf: false })
})

Deno.test('detachVoidedInvoice still succeeds when Storage cannot delete the PDF', async () => {
  const result = await detachVoidedInvoice({
    detach: () => Promise.resolve({ removedStoragePath: '3/invoice/b.pdf', voidedInvoiceNumber: null }),
    removeStoredFile: () => Promise.reject(new Error('storage down')),
  }, 3)

  assertEquals(result, { detached: true, voidedInvoiceNumber: null, removedPdf: false })
})

Deno.test('detachVoidedInvoice reports the database refusal', async () => {
  await assertRejects(
    () => detachVoidedInvoice({
      detach: () => Promise.reject(new Error('A cancelled Package cannot get a new invoice')),
      removeStoredFile: () => Promise.resolve(),
    }, 9),
    Error,
    'cannot get a new invoice',
  )
})
