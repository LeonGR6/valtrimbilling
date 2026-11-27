import { assertEquals, assertRejects } from '@std/assert'
import { RESET_REASON, resetTestInvoice } from './quickbooksInvoiceReset.ts'

Deno.test('resetTestInvoice resets the Package and deletes the saved PDF', async () => {
  const calls: string[] = []
  const result = await resetTestInvoice({
    reset: (id, reason) => {
      calls.push(`reset ${id} ${reason}`)
      return Promise.resolve({ removedStoragePath: '12/invoice/a.pdf' })
    },
    removeStoredFile: (path) => {
      calls.push(`remove ${path}`)
      return Promise.resolve()
    },
  }, 12)

  assertEquals(result, { reset: true, removedPdf: true })
  assertEquals(calls, [`reset 12 ${RESET_REASON}`, 'remove 12/invoice/a.pdf'])
})

Deno.test('resetTestInvoice has nothing to delete when no PDF was saved', async () => {
  const result = await resetTestInvoice({
    reset: () => Promise.resolve({ removedStoragePath: null }),
    removeStoredFile: () => Promise.reject(new Error('must not be called')),
  }, 3)

  assertEquals(result, { reset: true, removedPdf: false })
})

Deno.test('resetTestInvoice still succeeds when Storage cannot delete the PDF', async () => {
  const result = await resetTestInvoice({
    reset: () => Promise.resolve({ removedStoragePath: '3/invoice/b.pdf' }),
    removeStoredFile: () => Promise.reject(new Error('storage down')),
  }, 3)

  assertEquals(result, { reset: true, removedPdf: false })
})

Deno.test('resetTestInvoice reports the database refusal', async () => {
  await assertRejects(
    () => resetTestInvoice({
      reset: () => Promise.reject(new Error('Only a Test invoice can be reset')),
      removeStoredFile: () => Promise.resolve(),
    }, 9),
    Error,
    'Only a Test invoice can be reset',
  )
})
