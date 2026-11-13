import { assertEquals } from '@std/assert'
import type { QuickbooksInvoiceDetail } from './quickbooksApi.ts'
import { deriveQuickbooksPaymentState } from './quickbooksPaymentState.ts'

const invoice = (overrides: Partial<QuickbooksInvoiceDetail> = {}): QuickbooksInvoiceDetail => ({
  id: '150',
  syncToken: '0',
  docNumber: 'DP-00000004',
  totalAmount: 1000,
  balance: 1000,
  linkedTransactions: [],
  dueDate: '2026-11-12',
  ...overrides,
})

const today = '2026-10-14'

Deno.test('an invoice nobody has paid is open until its due date passes', () => {
  assertEquals(deriveQuickbooksPaymentState(invoice(), today), { state: 'OPEN', overdue: false })
  assertEquals(
    deriveQuickbooksPaymentState(invoice({ dueDate: '2026-10-13' }), today),
    { state: 'OVERDUE', overdue: true },
  )
  // The due day itself is not late yet.
  assertEquals(
    deriveQuickbooksPaymentState(invoice({ dueDate: today }), today),
    { state: 'OPEN', overdue: false },
  )
})

Deno.test('a partial payment is partially paid, and can be overdue too', () => {
  assertEquals(
    deriveQuickbooksPaymentState(invoice({ balance: 400, linkedTransactions: ['Payment'] }), today),
    { state: 'PARTIALLY_PAID', overdue: false },
  )
  assertEquals(
    deriveQuickbooksPaymentState(
      invoice({ balance: 400, dueDate: '2026-10-01', linkedTransactions: ['Payment'] }),
      today,
    ),
    { state: 'PARTIALLY_PAID', overdue: true },
  )
})

Deno.test('a zero balance is paid with a payment and closed with only a credit', () => {
  assertEquals(
    deriveQuickbooksPaymentState(invoice({ balance: 0, linkedTransactions: ['Payment'] }), today),
    { state: 'PAID', overdue: false },
  )
  assertEquals(
    deriveQuickbooksPaymentState(invoice({ balance: 0, linkedTransactions: ['CreditMemo'] }), today),
    { state: 'CLOSED', overdue: false },
  )
  // Paid long after its due date is not overdue.
  assertEquals(
    deriveQuickbooksPaymentState(
      invoice({ balance: 0, dueDate: '2026-01-01', linkedTransactions: ['Payment'] }),
      today,
    ).overdue,
    false,
  )
})

Deno.test('a voided or missing invoice is never read as paid', () => {
  assertEquals(
    deriveQuickbooksPaymentState(invoice({ totalAmount: 0, balance: 0, privateNote: 'Voided' }), today),
    { state: 'VOIDED', overdue: false },
  )
  assertEquals(deriveQuickbooksPaymentState(null, today), { state: 'DELETED', overdue: false })
})

Deno.test('amounts are compared in cents so rounding cannot fake a payment', () => {
  assertEquals(
    deriveQuickbooksPaymentState(invoice({ totalAmount: 0.3, balance: 0.1 + 0.2 }), today).state,
    'OPEN',
  )
})
