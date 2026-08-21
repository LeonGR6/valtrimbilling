import assert from 'node:assert/strict'
import test from 'node:test'
import { initialBuilders } from '../src/features/builders/data/builders.js'
import { initialJobs } from '../src/features/jobs/data/jobs.js'
import {
  builderJobsPath,
  getJobBuilderId,
  jobBelongsToBuilder,
  jobPlanPricingPath,
  jobPlansOptionsPath,
  jobSequenceSheetPath,
} from '../src/features/jobs/utils/jobRoutes.js'

test('Job module routes keep the builder and Job identifiers', () => {
  assert.equal(builderJobsPath(2), '/jobs/builder/2')
  assert.equal(
    jobPlansOptionsPath(2, 1),
    '/jobs/builder/2/job/1/plans-options',
  )
  assert.equal(
    jobSequenceSheetPath(2, 1),
    '/sequence-sheets/builder/2/job/1',
  )
  assert.equal(
    jobSequenceSheetPath(2, 1, 2101),
    '/sequence-sheets/builder/2/job/1/phase/2101',
  )
  assert.equal(
    jobPlanPricingPath(2, 1),
    '/pricing/builder/2/job/1',
  )
})

test('Jobs resolve and validate their builder relationship', () => {
  const job = initialJobs.find((item) => item.id === 1)

  assert.equal(getJobBuilderId(job, initialBuilders), 2)
  assert.equal(jobBelongsToBuilder(job, 2, initialBuilders), true)
  assert.equal(jobBelongsToBuilder(job, 1, initialBuilders), false)
})
