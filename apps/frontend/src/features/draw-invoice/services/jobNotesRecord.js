// Internal notes on a Job: what the team wants at hand when it bills it (a call, a promise to pay, a
// document the Builder still needs). Like the notes of a Package, a note is added and never edited or
// removed, so the thread reads as a record of what was said about the Job.

import { noteAuthor, noteProblem, sortNotes } from '../utils/noteThread.js'

export const JOB_NOTE_MAX_LENGTH = 1000

// The roles that bill add them and read them. They can hold things like a promised payment date, so
// unlike the notes of a Package they are not open to every active user.
export const JOB_NOTE_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']

export function canUseJobNotes(role) {
  return JOB_NOTE_ROLES.includes(role)
}

export function toJobNote(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    body: row.body,
    authorId: row.created_by,
    authorName: row.author_name,
    createdAt: row.created_at,
  }
}

export const sortJobNotes = sortNotes

/** Who wrote a note, as it is shown next to it. */
export const jobNoteAuthor = noteAuthor

/** Why a note cannot be saved yet, or an empty string when it can. */
export function jobNoteProblem(body) {
  return noteProblem(body, JOB_NOTE_MAX_LENGTH)
}

export function toAddJobNoteRpc(jobId, body) {
  return {
    p_job_id: Number(jobId),
    p_body: String(body ?? '').trim(),
  }
}

/** What the person is told when a note could not be saved or read. */
export function jobNoteErrorMessage(error) {
  if (error?.code === '42501') return 'You do not have permission to use Job notes.'
  if (error?.code === 'P0002') return 'The Job no longer exists.'
  if (error?.code === '23514') return error.message || 'Review the note and try again.'
  return error?.message || 'The notes could not be loaded.'
}

/** What a thread amounts to: how many notes, and the last one written. */
export function summarizeJobNotes(notes) {
  return { count: notes.length, latest: notes[0] ?? null }
}

/** A note on one line, cut where it gets long, for a header that has room for a glimpse. */
export function notePreview(note, maxLength = 110) {
  const text = String(note?.body ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

/**
 * The notes left on the Packages of a Job, newest first, each with the number of the Package it was
 * written on. They are read, not written, from the Job's notes: a note about one Package stays with it.
 */
export function collectJobPackageNotes(packages, jobId) {
  return sortNotes(
    packages
      .filter((record) => String(record.jobId) === String(jobId))
      .flatMap((record) => (record.noteEntries ?? []).map((note) => ({
        ...note,
        key: `package-${note.id}`,
        packageNumber: record.packageNumber,
      }))),
  )
}
