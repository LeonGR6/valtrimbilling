const andaraSequencePlans = [
  {
    id: 1101,
    code: '1',
    name: 'Plan 1',
    price: 2621,
    options: [
      {
        id: 110101,
        code: '1-OPT',
        description: '1 - Door at Primary Bath',
        price: null,
      },
    ],
  },
  {
    id: 1102,
    code: '2',
    name: 'Plan 2',
    price: null,
    options: [
      { id: 110201, code: '2-OPT', description: '2 - Door at Primary Bath', price: null },
      { id: 110202, code: '2-OPT', description: '2 - FLEX ROOM', price: null },
      { id: 110203, code: '2-ADA', description: 'UNIT 2X ADA', price: null },
      { id: 110204, code: '2-ADA-OPT', description: '2 - Door at Primary Bath', price: null },
      { id: 110205, code: '2-ADA-OPT', description: '2X - FLEX ROOM', price: null },
    ],
  },
  {
    id: 1103,
    code: '3',
    name: 'Plan 3',
    price: null,
    options: [
      { id: 110301, code: '3-OPT', description: '3 - Door at Primary Bath', price: null },
      { id: 110302, code: '3-OPT', description: 'No MDF Shelf laundry', price: null },
      { id: 110303, code: '3-W/UTI', description: '3 - W/UTI', price: null },
      { id: 110304, code: '3-W/UTI-OPT', description: '3 - Door at Primary Bath', price: null },
      { id: 110305, code: '3-W/UTI-OPT', description: 'No MDF Shelf laundry', price: null },
    ],
  },
]

export const jobBuilderOptions = [
  'KB Home',
  'City Ventures',
  'Trumark Homes',
  'Brookfield Residential',
]

export const initialJobs = [
  {
    id: 1,
    builderId: 2,
    code: '1307',
    builder: 'Trumark Homes',
    community: 'Andara',
    supervisorId: 1,
    superintendentId: 1,
    totalLots: 24,
    sequenceSheet: {
      id: 1001,
      name: 'Options Sequence Sheet',
      plans: andaraSequencePlans,
      phases: [
        {
          id: 2101,
          name: '10',
          building: '4',
          createdAt: '2026-08-18',
          lots: [
            {
              id: 3101,
              lotNumber: '1',
              planId: 1102,
              reverse: false,
              optionIds: [110201, 110202],
            },
            {
              id: 3102,
              lotNumber: '2',
              planId: 1101,
              reverse: true,
              optionIds: [110101],
            },
          ],
        },
      ],
    },
  },
  {
    id: 2,
    builderId: 1,
    code: '1308',
    builder: 'City Ventures',
    community: 'Cedar Grove',
    supervisorId: 1,
    superintendentId: 2,
    totalLots: 10,
    sequenceSheet: {
      id: 1002,
      name: 'Options Sequence Sheet',
      plans: [
        { id: 1201, code: '1A', name: 'Plan 1A', price: 2621, options: [] },
        { id: 1202, code: '1B', name: 'Plan 1B', price: 2621, options: [] },
        { id: 1203, code: '2A', name: 'Plan 2A', price: 4507, options: [] },
      ],
      phases: [],
    },
  },
  {
    id: 3,
    builderId: 4,
    code: '1309',
    builder: 'KB Home',
    community: 'Stonebrook',
    supervisorId: 2,
    superintendentId: 1,
    totalLots: 1,
    sequenceSheet: {
      id: 1003,
      name: 'Options Sequence Sheet',
      plans: [{ id: 1301, code: '1', name: 'Plan 1', price: null, options: [] }],
      phases: [],
    },
  },
  {
    id: 4,
    builderId: 3,
    code: '1310',
    builder: 'Brookfield Residential',
    community: 'Sky',
    supervisorId: 2,
    superintendentId: 5,
    totalLots: 8,
    sequenceSheet: {
      id: 1004,
      name: 'Options Sequence Sheet',
      plans: [],
      phases: [],
    },
  },
]

export const emptyJob = {
  code: '',
  builder: '',
  community: '',
  supervisorId: null,
  superintendentId: null,
  totalLots: '',
}

export const emptyJobPlan = {
  code: '',
  name: '',
}

export const emptyPlanOption = {
  code: '',
  description: '',
}

export function getJobUnitCount(job) {
  return getJobAssignedLotCount(job)
}

export function getJobPlanCount(job) {
  return job.sequenceSheet?.plans?.length ?? 0
}

export function getJobOptionCount(job) {
  return (job.sequenceSheet?.plans ?? []).reduce(
    (total, plan) => total + (plan.options?.length ?? 0),
    0,
  )
}

export function getJobSequenceColumnCount(job) {
  return getJobPlanCount(job) + getJobOptionCount(job)
}

export function getJobPhaseCount(job) {
  return job.sequenceSheet?.phases?.length ?? 0
}

export function getJobAssignedLotCount(job) {
  return (job.sequenceSheet?.phases ?? []).reduce(
    (total, phase) => total + (phase.lots?.length ?? 0),
    0,
  )
}

function getJobLotDependencies(job, predicate) {
  return (job.sequenceSheet?.phases ?? []).flatMap((phase) =>
    (phase.lots ?? [])
      .filter(predicate)
      .map((lot) => ({
        phaseId: phase.id,
        phaseName: phase.name,
        building: phase.building,
        lotId: lot.id,
        lotNumber: lot.lotNumber,
      })),
  )
}

export function getPlanLotDependencies(job, planId) {
  const plan = (job.sequenceSheet?.plans ?? []).find(
    (item) => item.id === planId,
  )
  const planOptionIds = new Set((plan?.options ?? []).map((option) => option.id))

  return getJobLotDependencies(
    job,
    (lot) =>
      lot.planId === planId ||
      (lot.optionIds ?? []).some((optionId) => planOptionIds.has(optionId)),
  )
}

export function getOptionLotDependencies(job, optionId) {
  return getJobLotDependencies(
    job,
    (lot) => (lot.optionIds ?? []).includes(optionId),
  )
}

export function formatJobHierarchy(job) {
  return [job.builder, job.community].filter(Boolean).join(' / ')
}
