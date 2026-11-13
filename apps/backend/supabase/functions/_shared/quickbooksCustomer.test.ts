import { assertEquals, assertRejects } from '@std/assert'
import { normalizeCustomerName, QuickbooksCustomerError, resolveBuilderCustomer } from './quickbooksCustomer.ts'

const customers = (...names: string[]) =>
  names.map((displayName, index) => ({ id: String(index + 1), displayName }))

const search = (...names: string[]) => () => Promise.resolve(customers(...names))

const noMapping = {
  mapping: null,
  verify: () => Promise.reject(new Error('should not verify')),
  clearMapping: () => Promise.reject(new Error('should not clear')),
}

Deno.test('uses a saved mapping that still exists, with its current name, without searching', async () => {
  const resolved = await resolveBuilderCustomer({
    builderName: 'Trumark',
    mapping: { customerId: '58', displayName: 'Trumark Homes LLC' },
    verify: () => Promise.resolve({ displayName: 'Trumark Homes Inc', active: true }),
    clearMapping: () => Promise.reject(new Error('should not clear')),
    search: () => Promise.reject(new Error('should not search')),
  })

  assertEquals(resolved, {
    customerId: '58',
    displayName: 'Trumark Homes Inc',
    source: 'mapping',
    replacedStale: false,
  })
})

Deno.test('a saved mapping whose Customer is gone or inactive is dropped and matched by name again', async () => {
  for (const current of [null, { displayName: 'Trumark', active: false }]) {
    let cleared = 0
    const resolved = await resolveBuilderCustomer({
      builderName: 'Trumark',
      mapping: { customerId: '58', displayName: 'Trumark' },
      verify: () => Promise.resolve(current),
      clearMapping: () => {
        cleared += 1
        return Promise.resolve()
      },
      search: search('Trumark'),
    })

    assertEquals(cleared, 1)
    assertEquals(resolved, { customerId: '1', displayName: 'Trumark', source: 'quickbooks', replacedStale: true })
  }
})

Deno.test('a dropped mapping with no match explains that the saved Customer is gone', async () => {
  await assertRejects(
    () =>
      resolveBuilderCustomer({
        builderName: 'Trumark',
        mapping: { customerId: '58', displayName: 'Trumark' },
        verify: () => Promise.resolve(null),
        clearMapping: () => Promise.resolve(),
        search: search(),
      }),
    QuickbooksCustomerError,
    'no longer exists or is inactive',
  )
})

Deno.test('matches the Builder name ignoring case and extra spaces', async () => {
  const resolved = await resolveBuilderCustomer({
    ...noMapping,
    builderName: '  trumark ',
    search: search('Trumark Homes', 'TRUMARK'),
  })

  assertEquals(resolved, { customerId: '2', displayName: 'TRUMARK', source: 'quickbooks', replacedStale: false })
  assertEquals(normalizeCustomerName('  Monte   Vista '), 'monte vista')
})

Deno.test('never uses a partial match: it is reported as a suggestion', async () => {
  const error = await assertRejects(
    () =>
      resolveBuilderCustomer({
        ...noMapping,
        builderName: 'Trumark',
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
    () => resolveBuilderCustomer({ ...noMapping, builderName: 'Monte Vista', search: search() }),
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
        ...noMapping,
        builderName: 'Trumark',
        search: search('Trumark', 'trumark'),
      }),
    QuickbooksCustomerError,
    '2 Customers named',
  )
  assertEquals(error.code, 'CUSTOMER_AMBIGUOUS')
})
