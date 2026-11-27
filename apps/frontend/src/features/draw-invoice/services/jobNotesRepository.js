import { requireSupabase } from '../../../services/api.js'
import { listAllRows } from '../../../services/pagedQuery.js'
import {
  jobNoteErrorMessage,
  sortJobNotes,
  toAddJobNoteRpc,
  toJobNote,
} from './jobNotesRecord.js'

const NOTE_COLUMNS = [
  'id',
  'job_id',
  'body',
  'created_by',
  'author_name',
  'created_at',
].join(', ')

async function readJobNotes(client, jobId) {
  const rows = await listAllRows(
    () => client
      .from('job_notes')
      .select(NOTE_COLUMNS)
      .eq('job_id', Number(jobId))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    (error) => {
      throw new Error(jobNoteErrorMessage(error), { cause: error })
    },
  )

  return sortJobNotes(rows.map(toJobNote))
}

/** The notes of one Job, newest first. Only Jobs that are opened are read, not every Job. */
export async function listJobNotes(jobId) {
  return readJobNotes(await requireSupabase(), jobId)
}

/** Adds a note to a Job as the signed-in user and returns the Job's notes, newest first. */
export async function addJobNote(jobId, body) {
  const client = await requireSupabase()
  const { error } = await client.rpc('add_job_note', toAddJobNoteRpc(jobId, body))

  if (error) throw new Error(jobNoteErrorMessage(error), { cause: error })

  return readJobNotes(client, jobId)
}
