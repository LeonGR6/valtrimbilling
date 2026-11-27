// What every thread of internal notes (of a Package, of a Job) has in common: it reads newest first,
// each note shows who wrote it, and a note must be worth saving.

function momentOf(note) {
  const time = new Date(note.createdAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

// Newest first; two notes of the same moment keep the order they were written in.
export function sortNotes(notes) {
  return [...notes].sort((left, right) => (
    momentOf(right) - momentOf(left) || Number(right.id) - Number(left.id)
  ))
}

/** Who wrote a note, as it is shown next to it. */
export function noteAuthor(note) {
  return String(note?.authorName ?? '').trim() || 'Unknown user'
}

/** Why a note cannot be saved yet, or an empty string when it can. */
export function noteProblem(body, maxLength) {
  const text = String(body ?? '').trim()
  if (!text) return 'Write the note before saving it.'
  if (text.length > maxLength) return `A note can have up to ${maxLength} characters.`
  return ''
}
