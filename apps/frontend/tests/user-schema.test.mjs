import test from 'node:test'
import assert from 'node:assert/strict'
import { createUserSchema } from '../src/features/users/schemas/userSchema.js'

function validUser(overrides = {}) {
  return {
    name: 'Project User',
    email: 'project.user@example.com',
    phone: '',
    phoneCountry: 'US',
    role: 'PROJECT_MANAGEMENT',
    allProjects: false,
    projectAccess: [12, 19],
    isActive: true,
    ...overrides,
  }
}

test('user access stores real numeric community ids', () => {
  const result = createUserSchema([], null).parse(validUser())
  assert.deepEqual(result.projectAccess, [12, 19])
})

test('a scoped user needs at least one community', () => {
  const result = createUserSchema([], null).safeParse(validUser({ projectAccess: [] }))
  assert.equal(result.success, false)
  assert.ok(result.error.issues.some(({ path }) => path.includes('projectAccess')))
})

test('the current user can keep their email while another user cannot reuse it', () => {
  const users = [{ id: 'existing-id', email: 'project.user@example.com' }]
  assert.equal(createUserSchema(users, 'existing-id').safeParse(validUser()).success, true)
  assert.equal(createUserSchema(users, null).safeParse(validUser()).success, false)
})
