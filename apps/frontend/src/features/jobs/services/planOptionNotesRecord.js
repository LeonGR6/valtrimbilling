// Notes on the Plans and on the Options of a Job: two threads on its Plans & Options page. Like the notes of a
// Package and of a Job, a note is added and never edited or removed, so each thread reads as a record of who
// said what and when.

import { PLANNING_ROLES } from '../../auth/authorization/roleAccess.js'
import { noteAuthor, noteProblem, sortNotes } from '../../draw-invoice/utils/noteThread.js'

export const PLAN_OPTION_NOTE_MAX_LENGTH = 1000

export const NOTE_KINDS = {
  PLANS: 'PLANS',
  OPTIONS: 'OPTIONS',
}

// The roles that keep the Plans and Options add the notes; every active user reads them.
export const PLAN_OPTION_NOTE_ROLES = PLANNING_ROLES

export function canAddPlanOptionNotes(role) {
  return PLAN_OPTION_NOTE_ROLES.includes(role)
}

export function toPlanOptionNote(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    kind: row.kind,
    body: row.body,
    authorId: row.created_by,
    authorName: row.author_name,
    createdAt: row.created_at,
  }
}

/** The notes of one thread, newest first. */
export function notesOfKind(notes, kind) {
  return sortNotes(notes.filter((note) => note.kind === kind))
}

export const planOptionNoteAuthor = noteAuthor

/** Why a note cannot be saved yet, or an empty string when it can. */
export function planOptionNoteProblem(body) {
  return noteProblem(body, PLAN_OPTION_NOTE_MAX_LENGTH)
}

export function toAddPlanOptionNoteRpc(jobId, kind, body) {
  return {
    p_job_id: Number(jobId),
    p_kind: kind,
    p_body: String(body ?? '').trim(),
  }
}

/** What the person is told when a note could not be saved or read. */
export function planOptionNoteErrorMessage(error) {
  if (error?.code === '42501') return 'You do not have permission to add Plan or Option notes.'
  if (error?.code === 'P0002') return 'The Job no longer exists.'
  if (error?.code === '23514') return error.message || 'Review the note and try again.'
  return error?.message || 'The notes could not be loaded.'
}
