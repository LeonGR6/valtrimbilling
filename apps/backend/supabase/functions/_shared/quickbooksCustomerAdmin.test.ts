import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  type CustomerAdminDeps,
  handleCustomerAction,
  parseCustomerAdminInput,
  QuickbooksCustomerAdminError,
} from './quickbooksCustomerAdmin.ts'

function harness(overrides: Partial<CustomerAdminDeps> = {}) {
  const calls: string[] = []
  const deps: CustomerAdminDeps = {
    getEnvironment: () => Promise.resolve('sandbox'),
    openApi: () => {
      calls.push('openApi')
      return Promise.resolve({ environment: 'sandbox', realmId: '9341', accessToken: 'tok' })
    },
    listCustomers: () => {
      calls.push('list')
      return Promise.resolve([
        { id: '58', displayName: 'Trumark Homes' },
        { id: '61', displayName: 'Olson Homes' },
      ])
    },
    searchCustomers: (_api, query) => {
      calls.push(`search:${query}`)
      return Promise.resolve([{ id: '58', displayName: 'Trumark Homes' }])
    },
    getCustomer: () => Promise.resolve({ id: '58', displayName: 'Trumark Homes', active: true }),
    saveMapping: (builderId, environment, customer) => {
      calls.push(`save:${builderId}:${environment}:${customer.customerId}:${customer.displayName}`)
      return Promise.resolve()
    },
    deleteMapping: (builderId, environment) => {
      calls.push(`delete:${builderId}:${environment}`)
      return Promise.resolve(true)
    },
    ...overrides,
  }
  return { deps, calls }
}

Deno.test('validates the request before doing anything', () => {
  assertEquals(parseCustomerAdminInput({ action: 'search', query: '  Tru ' }), { action: 'search', query: 'Tru' })
  assertEquals(parseCustomerAdminInput({ action: 'link', builderId: 1, customerId: ' 58 ' }), {
    action: 'link',
    builderId: 1,
    customerId: '58',
  })
  assertEquals(parseCustomerAdminInput({ action: 'unlink', builderId: 2 }), { action: 'unlink', builderId: 2 })

  for (const bad of [null, {}, { action: 'search', query: 'a' }, { action: 'link', builderId: 0, customerId: '1' },
    { action: 'link', builderId: 1, customerId: ' ' }, { action: 'unlink', builderId: '1' }, { action: 'delete' }]) {
    const error = assertThrows(() => parseCustomerAdminInput(bad), QuickbooksCustomerAdminError)
    assertEquals(error.code, 'INVALID_INPUT')
  }
})

Deno.test('lists every QuickBooks Customer to choose one by hand', async () => {
  const { deps, calls } = harness()

  assertEquals(parseCustomerAdminInput({ action: 'list' }), { action: 'list' })
  const result = await handleCustomerAction(deps, { action: 'list' })

  assertEquals(result, {
    customers: [
      { id: '58', displayName: 'Trumark Homes' },
      { id: '61', displayName: 'Olson Homes' },
    ],
  })
  assertEquals(calls, ['openApi', 'list'])
})

Deno.test('listing needs a connected QuickBooks', async () => {
  const { deps } = harness({ getEnvironment: () => Promise.resolve(null) })

  const error = await assertRejects(
    () => handleCustomerAction(deps, { action: 'list' }),
    QuickbooksCustomerAdminError,
  )
  assertEquals(error.code, 'NOT_CONNECTED')
})

Deno.test('searches QuickBooks Customers', async () => {
  const { deps, calls } = harness()

  const result = await handleCustomerAction(deps, { action: 'search', query: 'Trumark' })

  assertEquals(result, { customers: [{ id: '58', displayName: 'Trumark Homes' }] })
  assertEquals(calls, ['openApi', 'search:Trumark'])
})

Deno.test('links a Builder to a Customer that exists, saving the name QuickBooks has', async () => {
  const { deps, calls } = harness()

  const result = await handleCustomerAction(deps, { action: 'link', builderId: 1, customerId: '58' })

  assertEquals(result, { customer: { id: '58', displayName: 'Trumark Homes' } })
  assertEquals(calls.at(-1), 'save:1:sandbox:58:Trumark Homes')
})

Deno.test('refuses to link a Customer that is missing or inactive, and saves nothing', async () => {
  const missing = harness({ getCustomer: () => Promise.resolve(null) })
  const notFound = await assertRejects(
    () => handleCustomerAction(missing.deps, { action: 'link', builderId: 1, customerId: '999' }),
    QuickbooksCustomerAdminError,
  )
  assertEquals(notFound.code, 'CUSTOMER_NOT_FOUND')

  const inactive = harness({
    getCustomer: () => Promise.resolve({ id: '58', displayName: 'Old Co', active: false }),
  })
  const refused = await assertRejects(
    () => handleCustomerAction(inactive.deps, { action: 'link', builderId: 1, customerId: '58' }),
    QuickbooksCustomerAdminError,
    '"Old Co" is inactive',
  )
  assertEquals(refused.code, 'CUSTOMER_INACTIVE')

  for (const { calls } of [missing, inactive]) {
    assertEquals(calls.some((call) => call.startsWith('save:')), false)
  }
})

Deno.test('unlinking needs no QuickBooks session', async () => {
  const { deps, calls } = harness()

  assertEquals(await handleCustomerAction(deps, { action: 'unlink', builderId: 3 }), { removed: true })
  assertEquals(calls, ['delete:3:sandbox'])
})

Deno.test('every action fails clearly when QuickBooks is not connected', async () => {
  const { deps, calls } = harness({ getEnvironment: () => Promise.resolve(null) })

  for (const input of [
    { action: 'search', query: 'Trumark' },
    { action: 'link', builderId: 1, customerId: '58' },
    { action: 'unlink', builderId: 1 },
  ] as const) {
    const error = await assertRejects(() => handleCustomerAction(deps, input), QuickbooksCustomerAdminError)
    assertEquals(error.code, 'NOT_CONNECTED')
  }
  assertEquals(calls, [])
})
