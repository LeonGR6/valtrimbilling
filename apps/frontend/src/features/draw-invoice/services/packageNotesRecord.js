// Internal notes on a Package: a thread of entries, each with who wrote it and when. A note is added
// and never edited or removed, so the thread reads as a record of what was said about the Package.

import { noteAuthor, noteProblem, sortNotes } from '../utils/noteThread.js'

export const PACKAGE_NOTE_MAX_LENGTH = 1000

// The note written while a Package is created travels with it and is saved as its first note, so it
// is shorter; any other note is added afterwards from the Package page.
export const NEW_PACKAGE_NOTE_MAX_LENGTH = 500

// The same roles that can generate a Package's Release can leave a note; every active user reads them.
export const PACKAGE_NOTE_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']

/** What sits under the note box of a dialog that creates Package(s): the count, and where it goes. */
export function newPackageNoteHelp(note, packageCount = 1) {
  const used = `${String(note ?? '').trim().length}/${NEW_PACKAGE_NOTE_MAX_LENGTH}`

  return packageCount > 1
    ? `${used} · It is added to the notes of each of the ${packageCount} Packages, with your name and the time.`
    : `${used} · It becomes the first note of the Package, with your name and the time.`
}

export function canAddPackageNotes(role) {
  return PACKAGE_NOTE_ROLES.includes(role)
}

export function toPackageNote(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    body: row.body,
    authorId: row.created_by,
    authorName: row.author_name,
    createdAt: row.created_at,
  }
}

export const sortPackageNotes = sortNotes

/** What the thread of a Package amounts to: how many notes, and the last one written. */
export function summarizePackageNotes(record) {
  const notes = record?.noteEntries ?? []
  return { count: notes.length, latest: notes[0] ?? null }
}

/** Why a note cannot be saved yet, or an empty string when it can. */
export function packageNoteProblem(body) {
  return noteProblem(body, PACKAGE_NOTE_MAX_LENGTH)
}

export function toAddPackageNoteRpc(packageId, body) {
  return {
    p_package_id: Number(packageId),
    p_body: String(body ?? '').trim(),
  }
}

/** Who wrote a note, as it is shown next to it. */
export const packageNoteAuthor = noteAuthor

/** What the person is told when a note could not be saved. */
export function packageNoteErrorMessage(error) {
  if (error?.code === '42501') return 'You do not have permission to add notes to Packages.'
  if (error?.code === 'P0002') return 'The Package no longer exists.'
  if (error?.code === '23514') return error.message || 'Review the note and try again.'
  return error?.message || 'The note could not be saved.'
}
