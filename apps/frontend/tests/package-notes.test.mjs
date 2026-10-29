import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PACKAGE_NOTE_MAX_LENGTH,
  canAddPackageNotes,
  packageNoteAuthor,
  packageNoteErrorMessage,
  packageNoteProblem,
  sortPackageNotes,
  summarizePackageNotes,
  toAddPackageNoteRpc,
  toPackageNote,
} from '../src/features/draw-invoice/services/packageNotesRecord.js'
import { formatDateTime } from '../src/features/draw-invoice/utils/drawInvoiceFormatters.js'

const row = (overrides = {}) => ({
  id: 5,
  package_id: 12,
  body: 'Called the builder; promised payment on the 20th.',
  created_by: 'user-1',
  author_name: 'Ana Pérez',
  created_at: '2026-11-12T20:42:00.000Z',
  ...overrides,
})

test('a note keeps its text, its author and the moment it was written', () => {
  assert.deepEqual(toPackageNote(row()), {
    id: 5,
    packageId: 12,
    body: 'Called the builder; promised payment on the 20th.',
    authorId: 'user-1',
    authorName: 'Ana Pérez',
    createdAt: '2026-11-12T20:42:00.000Z',
  })
})

test('the thread reads newest first, and notes of the same moment keep their writing order', () => {
  const notes = [
    toPackageNote(row({ id: 1, created_at: '2026-11-10T15:00:00.000Z' })),
    toPackageNote(row({ id: 3, created_at: '2026-11-12T20:42:00.000Z' })),
    toPackageNote(row({ id: 2, created_at: '2026-11-12T20:42:00.000Z' })),
  ]

  assert.deepEqual(sortPackageNotes(notes).map((note) => note.id), [3, 2, 1])
  assert.deepEqual(notes.map((note) => note.id), [1, 3, 2], 'the list that was given is not reordered')
})

test('a Package amounts to how many notes it has and the last one written', () => {
  const noteEntries = sortPackageNotes([
    toPackageNote(row({ id: 1, created_at: '2026-11-10T15:00:00.000Z' })),
    toPackageNote(row({ id: 2, created_at: '2026-11-12T20:42:00.000Z' })),
  ])

  assert.equal(summarizePackageNotes({ noteEntries }).count, 2)
  assert.equal(summarizePackageNotes({ noteEntries }).latest.id, 2)
  assert.deepEqual(summarizePackageNotes({ noteEntries: [] }), { count: 0, latest: null })
  assert.deepEqual(summarizePackageNotes({}), { count: 0, latest: null })
  assert.deepEqual(summarizePackageNotes(null), { count: 0, latest: null })
})

test('an empty note, or one that is too long, cannot be saved', () => {
  assert.match(packageNoteProblem(''), /Write the note/u)
  assert.match(packageNoteProblem('   \n  '), /Write the note/u)
  assert.match(packageNoteProblem(null), /Write the note/u)
  assert.equal(packageNoteProblem('Called AP.'), '')
  assert.equal(packageNoteProblem('x'.repeat(PACKAGE_NOTE_MAX_LENGTH)), '')
  assert.equal(packageNoteProblem(`  ${'x'.repeat(PACKAGE_NOTE_MAX_LENGTH)}  `), '', 'the spaces around it do not count')
  assert.match(packageNoteProblem('x'.repeat(PACKAGE_NOTE_MAX_LENGTH + 1)), /1000 characters/u)
})

test('the note is sent trimmed, to the Package it was written on', () => {
  assert.deepEqual(toAddPackageNoteRpc('12', '  Called AP.  '), {
    p_package_id: 12,
    p_body: 'Called AP.',
  })
})

test('only the roles that bill can add notes', () => {
  assert.equal(canAddPackageNotes('ADMIN'), true)
  assert.equal(canAddPackageNotes('ACCOUNTING'), true)
  assert.equal(canAddPackageNotes('PROJECT_MANAGEMENT'), true)
  assert.equal(canAddPackageNotes('SCHEDULING'), false)
  assert.equal(canAddPackageNotes('FIELD'), false)
  assert.equal(canAddPackageNotes('READ_ONLY'), false)
  assert.equal(canAddPackageNotes(undefined), false)
})

test('a note without a name still says it is from someone', () => {
  assert.equal(packageNoteAuthor({ authorName: 'Ana Pérez' }), 'Ana Pérez')
  assert.equal(packageNoteAuthor({ authorName: '  ' }), 'Unknown user')
  assert.equal(packageNoteAuthor({}), 'Unknown user')
})

test('a note that could not be saved says why', () => {
  assert.match(packageNoteErrorMessage({ code: '42501' }), /permission/u)
  assert.match(packageNoteErrorMessage({ code: 'P0002' }), /no longer exists/u)
  assert.equal(
    packageNoteErrorMessage({ code: '23514', message: 'Write the note before saving it' }),
    'Write the note before saving it',
  )
  assert.equal(packageNoteErrorMessage(new Error('Network down')), 'Network down')
  assert.equal(packageNoteErrorMessage(null), 'The note could not be saved.')
})

test('the moment of a note shows the date and the time', () => {
  const shown = formatDateTime('2026-11-12T20:42:00.000Z')

  assert.match(shown, /2026/u)
  assert.match(shown, /\d{1,2}:\d{2}\s?(AM|PM)/u)
  assert.equal(formatDateTime(null), '—')
  assert.equal(formatDateTime('not a date'), '—')
})
