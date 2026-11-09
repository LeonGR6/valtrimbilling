import { useMemo, useState } from 'react'
import { filterSuggestions, suggestionBuilders, suggestionSubmissionMethods } from '../utils/suggestionFilters.js'

// A filter is worth having once there is more than one suggestion to choose from.
const FILTER_FROM = 2

/**
 * The Builder, Job and Submitted by filter of one suggestion card. Each card keeps its own, so filtering one list does
 * not change the others.
 */
export function useSuggestionFilter(suggestions) {
  const [builder, setBuilder] = useState('')
  const [job, setJob] = useState('')
  const [submission, setSubmission] = useState('')
  const builders = useMemo(() => suggestionBuilders(suggestions), [suggestions])
  // A Builder that left the list (the suggestions were refreshed) stops filtering.
  const activeBuilder = builders.includes(builder) ? builder : ''
  const submissionMethods = useMemo(() => suggestionSubmissionMethods(suggestions), [suggestions])
  const activeSubmission = submissionMethods.includes(submission) ? submission : ''
  const filtered = useMemo(
    () => filterSuggestions(suggestions, { builder: activeBuilder, job, submission: activeSubmission }),
    [suggestions, activeBuilder, job, activeSubmission],
  )

  return {
    builders,
    builder: activeBuilder,
    job,
    submissionMethods,
    submission: activeSubmission,
    setBuilder,
    setJob,
    setSubmission,
    filtered,
    total: suggestions.length,
    isFiltering: Boolean(activeBuilder || job.trim() || activeSubmission),
    visible: suggestions.length >= FILTER_FROM,
    clear: () => {
      setBuilder('')
      setJob('')
      setSubmission('')
    },
  }
}
