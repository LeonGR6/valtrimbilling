import { useMemo } from 'react'

import { useJobs } from '../../jobs/context/useJobs.js'
import { coveredLots, summarizeCoverage } from '../utils/coverage.js'
import {
  buildChangeOrderLines,
  buildPlaceLines,
  summarizeChangeOrderLines,
} from '../utils/pricing.js'

/**
 * The Job being covered, the Lots the coverage reaches and the line each one
 * is (its Scope of Work and Amount), plus the lines without a Lot, from the
 * form values.
 * The Jobs offered are the ones of the Builder and Community chosen.
 */
export function useChangeOrderCoverage(values) {
  const { jobs } = useJobs()
  const {
    builderId, community, jobId, coverageMode, lotIds, recordIds, planIds,
    defaultScope, defaultAmount, lineOverrides, placeLines,
  } = values

  const jobOptions = useMemo(() => (
    builderId && community
      ? jobs.filter((job) => (
        String(job.builderId) === String(builderId) && job.community === community
      ))
      : []
  ), [jobs, builderId, community])
  const job = jobOptions.find((item) => String(item.id) === String(jobId)) ?? null

  const rows = useMemo(
    () => (job ? coveredLots(job, { mode: coverageMode, lotIds, recordIds, planIds }) : []),
    [job, coverageMode, lotIds, recordIds, planIds],
  )
  const summary = useMemo(() => summarizeCoverage(rows), [rows])
  const lines = useMemo(
    () => buildChangeOrderLines(rows, { defaultScope, defaultAmount, lineOverrides }),
    [rows, defaultScope, defaultAmount, lineOverrides],
  )
  const places = useMemo(() => buildPlaceLines(placeLines), [placeLines])
  const amounts = useMemo(() => summarizeChangeOrderLines(lines, places), [lines, places])

  return { job, jobOptions, rows, summary, lines, places, amounts }
}
