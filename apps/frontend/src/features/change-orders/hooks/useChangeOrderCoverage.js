import { useMemo } from 'react'

import { useJobs } from '../../jobs/context/useJobs.js'
import { coveredLots, summarizeCoverage } from '../utils/coverage.js'
import { jobsOfBuilder } from '../utils/jobChoices.js'
import {
  buildChangeOrderLines,
  buildPlaceLines,
  summarizeChangeOrderLines,
} from '../utils/pricing.js'

/**
 * The Job being covered, the Lots the coverage reaches and the line each one
 * is (its Scope of Work and Amount), plus the lines without a Lot, from the
 * form values.
 * The Jobs offered are the ones of the Builder chosen; the Job (and with it the Community) is picked
 * from them in the first card.
 */
export function useChangeOrderCoverage(values) {
  const { jobs } = useJobs()
  const {
    builderId, jobId, coverageMode, lotIds, recordIds, planIds,
    defaultScope, defaultAmount, lineOverrides, placeLines, planRules,
  } = values

  const jobOptions = useMemo(() => jobsOfBuilder(jobs, builderId), [jobs, builderId])
  const job = jobOptions.find((item) => String(item.id) === String(jobId)) ?? null

  const rows = useMemo(
    () => (job ? coveredLots(job, { mode: coverageMode, lotIds, recordIds, planIds }) : []),
    [job, coverageMode, lotIds, recordIds, planIds],
  )
  const summary = useMemo(() => summarizeCoverage(rows), [rows])
  // With Specific Plan Types each Lot follows the Scope and Amount of its Plan.
  const lines = useMemo(
    () => buildChangeOrderLines(rows, {
      defaultScope,
      defaultAmount,
      lineOverrides,
      rulesByPlan: coverageMode === 'plans' ? (planRules ?? {}) : null,
    }),
    [rows, defaultScope, defaultAmount, lineOverrides, coverageMode, planRules],
  )
  const places = useMemo(() => buildPlaceLines(placeLines), [placeLines])
  const amounts = useMemo(() => summarizeChangeOrderLines(lines, places), [lines, places])

  return { job, jobOptions, rows, summary, lines, places, amounts }
}
