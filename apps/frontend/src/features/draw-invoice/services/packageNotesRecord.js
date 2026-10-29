// Internal notes on a Package: a thread of entries, each with who wrote it and when. A note is added
// and never edited or removed, so the thread reads as a record of what was said about the Package.

export const PACKAGE_NOTE_MAX_LENGTH = 1000

// The same roles that can generate a Package's Release can leave a note; every active user reads them.
export const PACKAGE_NOTE_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']

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

function momentOf(note) {
  const time = new Date(note.createdAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

// Newest first; two notes of the same moment keep the order they were written in.
export function sortPackageNotes(notes) {
  return [...notes].sort((left, right) => (
    momentOf(right) - momentOf(left) || Number(right.id) - Number(left.id)
  ))
}

/** What the thread of a Package amounts to: how many notes, and the last one written. */
export function summarizePackageNotes(record) {
  const notes = record?.noteEntries ?? []
  return { count: notes.length, latest: notes[0] ?? null }
}

/** Why a note cannot be saved yet, or an empty string when it can. */
export function packageNoteProblem(body) {
  const text = String(body ?? '').trim()
  if (!text) return 'Write the note before saving it.'
  if (text.length > PACKAGE_NOTE_MAX_LENGTH) {
    return `A note can have up to ${PACKAGE_NOTE_MAX_LENGTH} characters.`
  }
  return ''
}

export function toAddPackageNoteRpc(packageId, body) {
  return {
    p_package_id: Number(packageId),
    p_body: String(body ?? '').trim(),
  }
}

/** Who wrote a note, as it is shown next to it. */
export function packageNoteAuthor(note) {
  return String(note?.authorName ?? '').trim() || 'Unknown user'
}

/** What the person is told when a note could not be saved. */
export function packageNoteErrorMessage(error) {
  if (error?.code === '42501') return 'You do not have permission to add notes to Packages.'
  if (error?.code === 'P0002') return 'The Package no longer exists.'
  if (error?.code === '23514') return error.message || 'Review the note and try again.'
  return error?.message || 'The note could not be saved.'
}
