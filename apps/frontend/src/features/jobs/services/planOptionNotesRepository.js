import { requireSupabase } from '../../../services/api.js'
import { listAllRows } from '../../../services/pagedQuery.js'
import {
  planOptionNoteErrorMessage,
  toAddPlanOptionNoteRpc,
  toPlanOptionNote,
} from './planOptionNotesRecord.js'

const NOTE_COLUMNS = ['id', 'job_id', 'kind', 'body', 'created_by', 'author_name', 'created_at'].join(', ')

async function readNotes(client, jobId) {
  const rows = await listAllRows(
    () => client
      .from('plan_option_notes')
      .select(NOTE_COLUMNS)
      .eq('job_id', Number(jobId))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    (error) => {
      throw new Error(planOptionNoteErrorMessage(error), { cause: error })
    },
  )

  return rows.map(toPlanOptionNote)
}

/** The notes of the Plans and of the Options of one Job. Only the Job that is opened is read. */
export async function listPlanOptionNotes(jobId) {
  return readNotes(await requireSupabase(), jobId)
}

/** Adds a note to the Plans or the Options of a Job as the signed-in user and returns the Job's notes. */
export async function addPlanOptionNote(jobId, kind, body) {
  const client = await requireSupabase()
  const { error } = await client.rpc('add_plan_option_note', toAddPlanOptionNoteRpc(jobId, kind, body))

  if (error) throw new Error(planOptionNoteErrorMessage(error), { cause: error })

  return readNotes(client, jobId)
}
