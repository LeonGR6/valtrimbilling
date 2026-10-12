import { assertEquals, assertRejects } from '@std/assert'
import {
  createQuickbooksInvoice,
  findQuickbooksCustomers,
  getQuickbooksCustomer,
  getQuickbooksInvoice,
  getQuickbooksInvoicePdf,
  voidQuickbooksInvoice,
  QuickbooksApiError,
  type QuickbooksApiOptions,
} from './quickbooksApi.ts'
import type { QuickbooksInvoicePayload } from './quickbooksInvoice.ts'

const options: QuickbooksApiOptions = { environment: 'sandbox', realmId: '9341', accessToken: 'tok' }

const payload: QuickbooksInvoicePayload = {
  CustomerRef: { value: '58' },
  TxnDate: '2026-10-09',
  Line: [],
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function recording(response: Response | Error) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const fetcher = ((input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init })
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  }) as typeof fetch
  return { fetcher, calls }
}

Deno.test('searches Customers by DisplayName and ignores malformed rows', async () => {
  const { fetcher, calls } = recording(
    reply({
      QueryResponse: {
        Customer: [{ Id: '58', DisplayName: 'Trumark' }, { Id: 7 }, { DisplayName: 'No id' }],
      },
    }),
  )

  const found = await findQuickbooksCustomers(options, "O'Brien %Homes", fetcher)

  assertEquals(found, [{ id: '58', displayName: 'Trumark' }])
  assertEquals(
    calls[0].url.searchParams.get('query'),
    "select Id, DisplayName from Customer where DisplayName like '%O\\'Brien Homes%' maxresults 25",
  )
})

Deno.test('creates the invoice with an idempotency request id', async () => {
  const { fetcher, calls } = recording(
    reply({ Invoice: { Id: '147', DocNumber: 'DP-00000068', SyncToken: '0', TotalAmt: 2992.5 } }),
  )

  const created = await createQuickbooksInvoice(options, payload, 'req-123', fetcher)

  assertEquals(created, { id: '147', docNumber: 'DP-00000068', syncToken: '0', totalAmount: 2992.5 })
  assertEquals(calls[0].url.pathname, '/v3/company/9341/invoice')
  assertEquals(calls[0].url.searchParams.get('requestid'), 'req-123')
  assertEquals(calls[0].init?.method, 'POST')
  assertEquals(JSON.parse(String(calls[0].init?.body)), payload)
})

Deno.test('a QuickBooks validation fault is a definite failure', async () => {
  const error = await assertRejects(
    () =>
      createQuickbooksInvoice(
        options,
        payload,
        'req',
        recording(
          reply({ Fault: { Error: [{ Message: 'Invalid Reference Id', Detail: 'Customer not found' }] } }, 400),
        ).fetcher,
      ),
    QuickbooksApiError,
    'Creating the QuickBooks invoice failed: Customer not found',
  )
  assertEquals(error.definite, true)
  assertEquals(error.status, 400)
})

Deno.test('a network failure or 5xx may have created the invoice, so it is not definite', async () => {
  const network = await assertRejects(
    () => createQuickbooksInvoice(options, payload, 'req', recording(new Error('socket closed')).fetcher),
    QuickbooksApiError,
    'socket closed',
  )
  assertEquals(network.definite, false)

  const server = await assertRejects(
    () => createQuickbooksInvoice(options, payload, 'req', recording(reply({}, 503)).fetcher),
    QuickbooksApiError,
  )
  assertEquals(server.definite, false)

  const empty = await assertRejects(
    () => createQuickbooksInvoice(options, payload, 'req', recording(reply({ Invoice: {} })).fetcher),
    QuickbooksApiError,
    'returned no invoice',
  )
  assertEquals(empty.definite, false)
})

const faultReply = (code: string, status = 400) =>
  reply({ Fault: { Error: [{ Message: 'Object Not Found', Detail: 'Object Not Found : not here', code }] } }, status)

Deno.test('reads a Customer and says null when it no longer exists', async () => {
  const found = await getQuickbooksCustomer(
    options,
    '58',
    recording(reply({ Customer: { Id: '58', DisplayName: 'Trumark Homes', Active: false } })).fetcher,
  )
  assertEquals(found, { id: '58', displayName: 'Trumark Homes', active: false })

  assertEquals(await getQuickbooksCustomer(options, '999', recording(faultReply('610')).fetcher), null)
  await assertRejects(
    () => getQuickbooksCustomer(options, '58', recording(faultReply('5010')).fetcher),
    QuickbooksApiError,
  )
})

Deno.test('reads an invoice with its balance and linked payments', async () => {
  const { fetcher, calls } = recording(
    reply({
      Invoice: {
        Id: '146',
        SyncToken: '3',
        DocNumber: 'DP-00000029',
        TotalAmt: 13320,
        Balance: 13320,
        LinkedTxn: [{ TxnId: '9', TxnType: 'Payment' }],
      },
    }),
  )

  const invoice = await getQuickbooksInvoice(options, '146', fetcher)

  assertEquals(invoice, {
    id: '146',
    syncToken: '3',
    docNumber: 'DP-00000029',
    totalAmount: 13320,
    balance: 13320,
    linkedTransactions: ['Payment'],
  })
  assertEquals(calls[0].url.pathname, '/v3/company/9341/invoice/146')
  assertEquals(await getQuickbooksInvoice(options, '1', recording(faultReply('610')).fetcher), null)
})

Deno.test('voids an invoice with the operation=void sparse update', async () => {
  const { fetcher, calls } = recording(reply({ Invoice: { Id: '146', SyncToken: '4' } }))

  await voidQuickbooksInvoice(options, { id: '146', syncToken: '3' }, fetcher)

  assertEquals(calls[0].url.pathname, '/v3/company/9341/invoice')
  assertEquals(calls[0].url.searchParams.get('operation'), 'void')
  assertEquals(calls[0].init?.method, 'POST')
  assertEquals(JSON.parse(String(calls[0].init?.body)), { Id: '146', SyncToken: '3', sparse: true })

  const stale = await assertRejects(
    () => voidQuickbooksInvoice(options, { id: '146', syncToken: '1' }, recording(faultReply('5010')).fetcher),
    QuickbooksApiError,
    'Voiding the QuickBooks invoice failed',
  )
  assertEquals(stale.definite, true)
})

Deno.test('downloads the invoice PDF and refuses anything that is not one', async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])
  const { fetcher, calls } = recording(new Response(pdf, { status: 200, headers: { 'Content-Type': 'application/pdf' } }))

  const bytes = await getQuickbooksInvoicePdf(options, '146', fetcher)

  assertEquals([...bytes], [...pdf])
  assertEquals(calls[0].url.pathname, '/v3/company/9341/invoice/146/pdf')
  assertEquals((calls[0].init?.headers as Record<string, string>).Accept, 'application/pdf')

  await assertRejects(
    () => getQuickbooksInvoicePdf(options, '146', recording(new Response('<html>oops</html>', { status: 200 })).fetcher),
    QuickbooksApiError,
    'did not return a PDF',
  )
  await assertRejects(
    () => getQuickbooksInvoicePdf(options, '146', recording(faultReply('610')).fetcher),
    QuickbooksApiError,
    'Downloading the QuickBooks invoice PDF failed',
  )
})
