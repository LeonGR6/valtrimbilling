import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toJob,
  toJobMutation,
} from '../src/features/jobs/services/jobRecord.js'
import { resolveJobAssignmentNames } from '../src/features/jobs/utils/jobAssignments.js'

test('Job rows map the persisted catalog and initialize unopened child modules', () => {
  assert.deepEqual(toJob({
    id: 91,
    code: 'JOB-91',
    builder_id: 12,
    community: 'Andara',
    supervisor_id: 31,
    superintendent_id: 44,
    estimator_id: 45,
    job_coordinator_id: 46,
    purchasing_id: 47,
    scheduling_id: 48,
    options_coordinator_id: 49,
    billing_setup_version_id: 8,
    sequence_sheet_name: null,
    status: 'ACTIVE',
    notes: null,
    is_active: true,
    created_at: '2026-09-09T20:00:00Z',
    updated_at: '2026-09-09T20:00:00Z',
  }), {
    id: 91,
    code: 'JOB-91',
    builderId: 12,
    community: 'Andara',
    supervisorId: 31,
    superintendentId: 44,
    estimatorId: 45,
    jobCoordinatorId: 46,
    purchasingId: 47,
    schedulingId: 48,
    optionsCoordinatorId: 49,
    billingSetupVersionId: 8,
    sequenceSheetName: '',
    status: 'ACTIVE',
    notes: '',
    isActive: true,
    createdAt: '2026-09-09T20:00:00Z',
    updatedAt: '2026-09-09T20:00:00Z',
    sequenceSheet: {
      name: 'Options Sequence Sheet',
      plans: [],
      phases: [],
    },
  })
})

test('Job mutations expose only the fields owned by the current form', () => {
  assert.deepEqual(toJobMutation({
    id: 91,
    code: ' job-91 ',
    builderId: '12',
    community: '  Andara  ',
    supervisorId: '31',
    superintendentId: '44',
    estimatorId: '45',
    jobCoordinatorId: '46',
    purchasingId: '47',
    schedulingId: '48',
    optionsCoordinatorId: '49',
    billingSetupVersionId: 999,
    createdBy: 'browser-must-not-write-this',
  }), {
    code: 'JOB-91',
    builder_id: 12,
    community: 'Andara',
    supervisor_id: 31,
    superintendent_id: 44,
    estimator_id: 45,
    job_coordinator_id: 46,
    purchasing_id: 47,
    scheduling_id: 48,
    options_coordinator_id: 49,
  })
})

test('Job assignment ids resolve their persisted Supervisor and Superintendent names', () => {
  const names = resolveJobAssignmentNames(
    { supervisorId: 31, superintendentId: '44' },
    [
      { id: 31, name: '  Alex Supervisor  ', types: ['SUPERVISOR'], isActive: false },
      { id: 32, name: 'Wrong role', types: ['TECHNICIAN'], isActive: true },
    ],
    [
      {
        id: 44,
        name: 'Jordan Superintendent',
        type: 'JOBSITE_SUPERINTENDENT',
        isActive: false,
      },
    ],
  )

  assert.deepEqual(names, {
    supervisor: 'Alex Supervisor',
    jobsiteSuperintendent: 'Jordan Superintendent',
  })
})
