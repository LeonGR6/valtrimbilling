import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NOTE_KINDS,
  PLAN_OPTION_NOTE_MAX_LENGTH,
  canAddPlanOptionNotes,
  notesOfKind,
  planOptionNoteAuthor,
  planOptionNoteErrorMessage,
  planOptionNoteProblem,
  toAddPlanOptionNoteRpc,
  toPlanOptionNote,
} from '../src/features/jobs/services/planOptionNotesRecord.js'

const row = (overrides = {}) => ({
  id: 7,
  job_id: 1301,
  kind: 'PLANS',
  body: 'Plan 1204 changed in the last revision.',
  created_by: 'user-1',
  author_name: 'Ana Pérez',
  created_at: '2026-11-12T20:42:00.000Z',
  ...overrides,
})

test('a note keeps its thread, its text, its author and the moment it was written', () => {
  assert.deepEqual(toPlanOptionNote(row()), {
    id: 7,
    jobId: 1301,
    kind: 'PLANS',
    body: 'Plan 1204 changed in the last revision.',
    authorId: 'user-1',
    authorName: 'Ana Pérez',
    createdAt: '2026-11-12T20:42:00.000Z',
  })
})

test('only the roles that keep the Plans and Options add notes', () => {
  for (const role of ['ADMIN', 'PROJECT_MANAGEMENT']) assert.equal(canAddPlanOptionNotes(role), true, role)
  for (const role of ['ACCOUNTING', 'SCHEDULING', 'CUSTOMER_SERVICE', 'FIELD', 'READ_ONLY', undefined, null]) {
    assert.equal(canAddPlanOptionNotes(role), false, String(role))
  }
})

test('each thread shows only its own notes, newest first, and same-moment notes keep their writing order', () => {
  const notes = [
    toPlanOptionNote(row({ id: 1, created_at: '2026-11-10T10:00:00.000Z' })),
    toPlanOptionNote(row({ id: 2, kind: 'OPTIONS', created_at: '2026-11-11T10:00:00.000Z' })),
    toPlanOptionNote(row({ id: 4, created_at: '2026-11-12T10:00:00.000Z' })),
    toPlanOptionNote(row({ id: 3, created_at: '2026-11-12T10:00:00.000Z' })),
  ]

  assert.deepEqual(notesOfKind(notes, NOTE_KINDS.PLANS).map(({ id }) => id), [4, 3, 1])
  assert.deepEqual(notesOfKind(notes, NOTE_KINDS.OPTIONS).map(({ id }) => id), [2])
})

test('a note has an author, and a missing name is not left blank', () => {
  assert.equal(planOptionNoteAuthor(toPlanOptionNote(row())), 'Ana Pérez')
  assert.equal(planOptionNoteAuthor(toPlanOptionNote(row({ author_name: '  ' }))), 'Unknown user')
})

test('an empty or too long note cannot be saved', () => {
  assert.notEqual(planOptionNoteProblem('   '), '')
  assert.notEqual(planOptionNoteProblem('x'.repeat(PLAN_OPTION_NOTE_MAX_LENGTH + 1)), '')
  assert.equal(planOptionNoteProblem('Price pending'), '')
})

test('the call that saves a note names the Job, the thread and the trimmed text', () => {
  assert.deepEqual(toAddPlanOptionNoteRpc('1301', 'OPTIONS', '  Price pending  '), {
    p_job_id: 1301,
    p_kind: 'OPTIONS',
    p_body: 'Price pending',
  })
})

test('the person is told why a note could not be saved', () => {
  assert.match(planOptionNoteErrorMessage({ code: '42501' }), /permission/)
  assert.match(planOptionNoteErrorMessage({ code: 'P0002' }), /no longer exists/)
  assert.equal(planOptionNoteErrorMessage({ code: '23514', message: 'Write the note before saving it' }), 'Write the note before saving it')
  assert.equal(planOptionNoteErrorMessage(null), 'The notes could not be loaded.')
})
