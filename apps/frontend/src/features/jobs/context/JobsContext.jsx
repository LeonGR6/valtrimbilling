import { useMemo, useState } from 'react'
import { initialJobs } from '../data/jobs.js'
import { JobsContext } from './jobsContext.js'

export function JobsProvider({ children }) {
  const [jobs, setJobs] = useState(initialJobs)
  const value = useMemo(() => ({ jobs, setJobs }), [jobs])

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}
