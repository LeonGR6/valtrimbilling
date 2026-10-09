import { assertEquals, assertRejects } from '@std/assert'
import {
  createQuickbooksInvoice,
  findQuickbooksCustomers,
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
