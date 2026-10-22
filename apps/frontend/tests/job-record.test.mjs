import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toJob,
  toJobMutation,
} from '../src/features/jobs/services/jobRecord.js'
import { jobContactRoles as jobContactRolesForTest } from '../src/features/jobs/data/jobContactRoles.js'
import { contactTypesToAdd, resolveJobContacts } from '../src/features/jobs/utils/jobAssignments.js'

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
    project_manager_id: 50,
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
    projectManagerId: 50,
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
    projectManagerId: '50',
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
    project_manager_id: 50,
  })
})

test('a Job lists every contact by role with how to reach them', () => {
  const contacts = resolveJobContacts(
    { supervisorId: 31, superintendentId: '44', estimatorId: 5, schedulingId: 5 },
    [
      { id: 31, name: '  Alex Supervisor  ', email: 'alex@example.com', phone: '+17145550162' },
      { id: 5, name: 'Victor', email: 'victor@example.com', officePhone: '+17145550100' },
    ],
    [{ id: 44, name: 'Jordan Superintendent', email: 'jordan@example.com' }],
  )

  assert.deepEqual(contacts.map((contact) => contact.role), [
    'Supervisor',
    'Jobsite Superintendent',
    'Estimator',
    'Job Coordinator',
    'Purchasing',
    'Scheduling',
    'Options Coordinator',
    'Project Manager',
  ])
  assert.equal(contacts[0].name, 'Alex Supervisor')
  assert.equal(contacts[0].phone, '+17145550162')
  assert.equal(contacts[1].name, 'Jordan Superintendent')
  // The same person fills two roles and shows up in both; an empty role has no name.
  assert.deepEqual(
    [contacts[2].name, contacts[5].name, contacts[3].name],
    ['Victor', 'Victor', ''],
  )
  assert.equal(contacts[2].officePhone, '+17145550100')
})

test('a person picked for several roles gets each type they lack, once', () => {
  const roles = [
    { field: 'superintendentId', source: 'builder', type: 'JOBSITE_SUPERINTENDENT' },
    { field: 'estimatorId', source: 'company', type: 'ESTIMATOR' },
    { field: 'schedulingId', source: 'company', type: 'SCHEDULING' },
    { field: 'optionsCoordinatorId', source: 'company', type: 'OPTIONS_COORDINATOR' },
  ]
  const people = [
    { id: 1, name: 'Victor', types: ['SCHEDULING'] },
    { id: 2, name: 'Tony', types: ['ESTIMATOR'] },
  ]

  // Victor already is Scheduling and is also picked for Options Coordinator;
  // Tony is picked for the role he has. The builder-side role is not touched.
  const job = {
    superintendentId: 1,
    estimatorId: 2,
    schedulingId: 1,
    optionsCoordinatorId: 1,
  }

  assert.deepEqual(contactTypesToAdd(job, people, roles), [
    { person: people[0], types: ['SCHEDULING', 'OPTIONS_COORDINATOR'] },
  ])
  assert.deepEqual(
    contactTypesToAdd({ ...job, optionsCoordinatorId: 2, estimatorId: 2 }, people, roles),
    [{ person: people[1], types: ['ESTIMATOR', 'OPTIONS_COORDINATOR'] }],
  )
})

test('a Job without its optional contacts keeps them empty instead of turning them into 0', () => {
  const mutation = toJobMutation({
    code: 'job-92',
    builderId: 12,
    community: 'Andara',
    supervisorId: 31,
    superintendentId: 44,
    estimatorId: null,
    jobCoordinatorId: undefined,
    purchasingId: '',
  })

  assert.equal(mutation.supervisor_id, 31)
  assert.equal(mutation.superintendent_id, 44)
  for (const column of [
    'estimator_id',
    'job_coordinator_id',
    'purchasing_id',
    'scheduling_id',
    'options_coordinator_id',
    'project_manager_id',
  ]) {
    assert.equal(mutation[column], null, column)
  }

  const job = toJob({ id: 1, code: 'J', builder_id: 1, community: 'c', supervisor_id: 3, superintendent_id: 4, estimator_id: null, created_at: '2026-10-01T00:00:00Z' })
  assert.equal(job.estimatorId, null)
  assert.equal(job.projectManagerId, null)
})

test('the Project Manager is a contact of a Job, listed last and left out of the table when empty', () => {
  const people = [{ id: 31, name: 'Alex' }, { id: 60, name: 'Pat Manager', email: 'pat@example.com' }]
  const withPm = resolveJobContacts({ supervisorId: 31, projectManagerId: 60 }, people, [])
  const without = resolveJobContacts({ supervisorId: 31 }, people, [])

  assert.equal(withPm.at(-1).role, 'Project Manager')
  assert.equal(withPm.at(-1).name, 'Pat Manager')
  assert.equal(withPm.at(-1).optional, true)
  assert.equal(without.at(-1).name, '')
  assert.equal(without.find((contact) => contact.role === 'Supervisor').optional, false)
  assert.equal(without.find((contact) => contact.role === 'Jobsite Superintendent').optional, false)

  // Someone picked as Project Manager who lacks the type gets it when the Job is saved.
  assert.deepEqual(
    contactTypesToAdd({ projectManagerId: 60 }, [{ id: 60, types: ['SCHEDULING'] }], jobContactRolesForTest),
    [{ person: { id: 60, types: ['SCHEDULING'] }, types: ['SCHEDULING', 'PROJECT_MANAGER'] }],
  )
})
