import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JOB_NOTE_MAX_LENGTH,
  canUseJobNotes,
  collectJobPackageNotes,
  jobNoteAuthor,
  jobNoteErrorMessage,
  jobNoteProblem,
  notePreview,
  sortJobNotes,
  summarizeJobNotes,
  toAddJobNoteRpc,
  toJobNote,
} from '../src/features/draw-invoice/services/jobNotesRecord.js'

const row = (overrides = {}) => ({
  id: 7,
  job_id: 1301,
  body: 'The Builder needs the lien waiver before it pays.',
  created_by: 'user-1',
  author_name: 'Ana Pérez',
  created_at: '2026-11-12T20:42:00.000Z',
  ...overrides,
})

test('a Job note keeps its text, its author and the moment it was written', () => {
  assert.deepEqual(toJobNote(row()), {
    id: 7,
    jobId: 1301,
    body: 'The Builder needs the lien waiver before it pays.',
    authorId: 'user-1',
    authorName: 'Ana Pérez',
    createdAt: '2026-11-12T20:42:00.000Z',
  })
})

test('only the roles that bill use Job notes', () => {
  for (const role of ['ADMIN', 'ACCOUNTING', 'DRAW_INVOICE']) {
    assert.equal(canUseJobNotes(role), true, role)
  }
  for (const role of ['PROJECT_MANAGEMENT', 'FIELD', 'SCHEDULING', 'CUSTOMER_SERVICE', 'READ_ONLY', undefined, null]) {
    assert.equal(canUseJobNotes(role), false, String(role))
  }
})

test('the thread reads newest first, and notes of the same moment keep their writing order', () => {
  const notes = [
    toJobNote(row({ id: 1, created_at: '2026-11-10T10:00:00.000Z' })),
    toJobNote(row({ id: 3, created_at: '2026-11-12T10:00:00.000Z' })),
    toJobNote(row({ id: 2, created_at: '2026-11-12T10:00:00.000Z' })),
  ]

  assert.deepEqual(sortJobNotes(notes).map(({ id }) => id), [3, 2, 1])
})

test('a note has an author, and a missing name is not left blank', () => {
  assert.equal(jobNoteAuthor(toJobNote(row())), 'Ana Pérez')
  assert.equal(jobNoteAuthor(toJobNote(row({ author_name: '   ' }))), 'Unknown user')
})

test('a note cannot be saved empty or over the limit', () => {
  assert.equal(jobNoteProblem('  '), 'Write the note before saving it.')
  assert.equal(jobNoteProblem('Call the superintendent.'), '')
  assert.equal(jobNoteProblem('a'.repeat(JOB_NOTE_MAX_LENGTH)), '')
  assert.match(jobNoteProblem('a'.repeat(JOB_NOTE_MAX_LENGTH + 1)), /up to 1000 characters/)
})

test('the note is sent trimmed, with the Job as a number', () => {
  assert.deepEqual(toAddJobNoteRpc('1301', '  Call on Monday  '), {
    p_job_id: 1301,
    p_body: 'Call on Monday',
  })
})

test('the person is told why a note could not be saved', () => {
  assert.equal(jobNoteErrorMessage({ code: '42501' }), 'You do not have permission to use Job notes.')
  assert.equal(jobNoteErrorMessage({ code: 'P0002' }), 'The Job no longer exists.')
  assert.equal(jobNoteErrorMessage({ code: '23514', message: 'Too long' }), 'Too long')
  assert.equal(jobNoteErrorMessage({ message: 'Network down' }), 'Network down')
  assert.equal(jobNoteErrorMessage(null), 'The notes could not be loaded.')
})

test('a thread amounts to its count and its latest note', () => {
  const notes = sortJobNotes([
    toJobNote(row({ id: 1, created_at: '2026-11-10T10:00:00.000Z' })),
    toJobNote(row({ id: 2, created_at: '2026-11-12T10:00:00.000Z' })),
  ])

  assert.deepEqual(summarizeJobNotes(notes), { count: 2, latest: notes[0] })
  assert.deepEqual(summarizeJobNotes([]), { count: 0, latest: null })
})

test('a preview is one line and ends with an ellipsis only where it was cut', () => {
  assert.equal(notePreview({ body: 'Call\n  the   builder' }), 'Call the builder')
  assert.equal(notePreview({ body: 'x'.repeat(200) }, 20), `${'x'.repeat(19)}…`)
  assert.equal(notePreview({ body: 'short' }, 20), 'short')
  assert.equal(notePreview(null), '')
})

test('the notes of the Packages of a Job are listed newest first with their Package number', () => {
  const packages = [
    {
      jobId: 1301,
      packageNumber: 'DP-00000146',
      noteEntries: [{ id: 4, body: 'Invoice sent', authorName: 'Ana', createdAt: '2026-11-10T10:00:00.000Z' }],
    },
    {
      jobId: 1301,
      packageNumber: 'DP-00000150',
      noteEntries: [{ id: 9, body: 'Waiting on release', authorName: 'Luis', createdAt: '2026-11-12T10:00:00.000Z' }],
    },
    {
      jobId: 999,
      packageNumber: 'DP-00000001',
      noteEntries: [{ id: 1, body: 'Another Job', authorName: 'Ana', createdAt: '2026-11-13T10:00:00.000Z' }],
    },
    { jobId: 1301, packageNumber: 'DP-00000151' },
  ]

  assert.deepEqual(
    collectJobPackageNotes(packages, '1301').map(({ packageNumber, body, key }) => ({ packageNumber, body, key })),
    [
      { packageNumber: 'DP-00000150', body: 'Waiting on release', key: 'package-9' },
      { packageNumber: 'DP-00000146', body: 'Invoice sent', key: 'package-4' },
    ],
  )
  assert.deepEqual(collectJobPackageNotes(packages, 5), [])
})
