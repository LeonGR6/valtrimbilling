import { useCallback, useEffect, useState } from 'react'
import { addPlanOptionNote, listPlanOptionNotes } from '../services/planOptionNotesRepository.js'

const NONE = []

/**
 * The notes of the Plans and of the Options of a Job, read when it is opened. `add(kind, body)` saves a note
 * and keeps the notes the database returns; it throws, with a message to show, when the note could not be saved.
 */
export function usePlanOptionNotes(jobId) {
  const [state, setState] = useState({ jobId: null, notes: NONE, error: '' })
  const [reads, setReads] = useState(0)

  useEffect(() => {
    if (jobId == null) return undefined

    let cancelled = false
    listPlanOptionNotes(jobId)
      .then((notes) => {
        if (!cancelled) setState({ jobId, notes, error: '' })
      })
      .catch((error) => {
        if (!cancelled) setState({ jobId, notes: NONE, error: error.message })
      })

    return () => {
      cancelled = true
    }
  }, [jobId, reads])

  const add = useCallback(async (kind, body) => {
    const notes = await addPlanOptionNote(jobId, kind, body)
    setState({ jobId, notes, error: '' })
  }, [jobId])

  const reload = useCallback(() => {
    setState({ jobId: null, notes: NONE, error: '' })
    setReads((count) => count + 1)
  }, [])

  const current = jobId != null && state.jobId === jobId

  return {
    notes: current ? state.notes : NONE,
    loading: jobId != null && !current,
    error: current ? state.error : '',
    add,
    reload,
  }
}
