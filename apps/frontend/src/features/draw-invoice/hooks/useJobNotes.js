import { useCallback, useEffect, useState } from 'react'
import { addJobNote, listJobNotes } from '../services/jobNotesRepository.js'

const NONE = []

/**
 * The notes of a Job, read when it is chosen. `add(body)` saves a note and keeps the thread the
 * database returns; it throws, with a message to show, when the note could not be saved.
 */
export function useJobNotes(jobId) {
  const [state, setState] = useState({ jobId: null, notes: NONE, error: '' })
  const [reads, setReads] = useState(0)

  useEffect(() => {
    if (jobId == null) return undefined

    let cancelled = false
    listJobNotes(jobId)
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

  const add = useCallback(async (body) => {
    const notes = await addJobNote(jobId, body)
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
