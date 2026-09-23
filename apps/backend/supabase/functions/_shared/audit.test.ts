import { writeAuditEvents } from './audit.ts'

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    )
  }
}

Deno.test('audit events preserve actor, entity and changed values', async () => {
  let table = ''
  let insertedRows: Record<string, unknown>[] = []
  const db = {
    from(nextTable: string) {
      table = nextTable
      return {
        insert(rows: Record<string, unknown>[]) {
          insertedRows = rows
          return Promise.resolve({ error: null })
        },
      }
    },
  }

  const written = await writeAuditEvents(db as never, [{
    correlationId: '8a55f7f3-3456-4f77-bfda-ae8ae25d5e34',
    module: 'USERS',
    action: 'ROLE_CHANGED',
    result: 'SUCCESS',
    actor: {
      id: '1be95647-5374-48f4-8c48-bc0197b332da',
      name: 'Leon Garcia',
      email: 'leon@example.com',
      role: 'ADMIN',
    },
    targetUser: {
      id: 'cb19dd64-e600-4334-a3a5-f33b9add021c',
      name: 'Pedro Martinez',
      email: 'pedro@example.com',
    },
    entityType: 'USER',
    entityId: 'cb19dd64-e600-4334-a3a5-f33b9add021c',
    entityLabel: 'pedro@example.com',
    summary: 'Pedro Martinez received a new role.',
    previousValues: { role: 'FIELD' },
    newValues: { role: 'ADMIN' },
  }])

  assertEquals(written, true)
  assertEquals(table, 'audit_events')
  assertEquals(insertedRows[0].actor_name, 'Leon Garcia')
  assertEquals(insertedRows[0].entity_type, 'USER')
  assertEquals(insertedRows[0].previous_values, { role: 'FIELD' })
  assertEquals(insertedRows[0].new_values, { role: 'ADMIN' })
})
