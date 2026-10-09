import { assertEquals, assertRejects } from '@std/assert'
import { normalizeCustomerName, QuickbooksCustomerError, resolveBuilderCustomer } from './quickbooksCustomer.ts'

const customers = (...names: string[]) =>
  names.map((displayName, index) => ({ id: String(index + 1), displayName }))

const search = (...names: string[]) => () => Promise.resolve(customers(...names))

Deno.test('uses the saved mapping without searching QuickBooks', async () => {
  const resolved = await resolveBuilderCustomer({
    builderName: 'Trumark',
    mapping: { customerId: '58', displayName: 'Trumark Homes LLC' },
    search: () => Promise.reject(new Error('should not search')),
  })

  assertEquals(resolved, { customerId: '58', displayName: 'Trumark Homes LLC', source: 'mapping' })
})

Deno.test('matches the Builder name ignoring case and extra spaces', async () => {
  const resolved = await resolveBuilderCustomer({
    builderName: '  trumark ',
    mapping: null,
    search: search('Trumark Homes', 'TRUMARK'),
  })

  assertEquals(resolved, { customerId: '2', displayName: 'TRUMARK', source: 'quickbooks' })
  assertEquals(normalizeCustomerName('  Monte   Vista '), 'monte vista')
})

Deno.test('never uses a partial match: it is reported as a suggestion', async () => {
  const error = await assertRejects(
    () =>
      resolveBuilderCustomer({
        builderName: 'Trumark',
        mapping: null,
        search: search('Trumark Homes'),
      }),
    QuickbooksCustomerError,
    'Similar: Trumark Homes',
  )
  assertEquals(error.code, 'CUSTOMER_NOT_FOUND')
  assertEquals(error.candidates, ['Trumark Homes'])
})

Deno.test('a Builder that is not in the QuickBooks company asks to create it', async () => {
  const error = await assertRejects(
    () => resolveBuilderCustomer({ builderName: 'Monte Vista', mapping: null, search: search() }),
    QuickbooksCustomerError,
    'Create it in QuickBooks with that exact name',
  )
  assertEquals(error.code, 'CUSTOMER_NOT_FOUND')
  assertEquals(error.candidates, [])
})

Deno.test('two Customers with the same name are ambiguous', async () => {
  const error = await assertRejects(
    () =>
      resolveBuilderCustomer({
        builderName: 'Trumark',
        mapping: null,
        search: search('Trumark', 'trumark'),
      }),
    QuickbooksCustomerError,
    '2 Customers named',
  )
  assertEquals(error.code, 'CUSTOMER_AMBIGUOUS')
})
