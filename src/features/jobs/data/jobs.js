export const jobBuilderOptions = [
  'KB Home',
  'City Ventures',
  'Trumark Homes',
  'Brookfield Residential',
]

export const initialJobs = [
  {
    id: 1,
    code: 'JOB-1001',
    builder: 'KB Home',
    community: 'Andara',
    phase: '1',
    building: '3',
    lotFrom: '6',
    lotTo: '12',
  },
  {
    id: 2,
    code: 'JOB-1002',
    builder: 'City Ventures',
    community: 'Cedar Grove',
    phase: '2',
    building: '',
    lotFrom: '18',
    lotTo: '22',
  },
  {
    id: 3,
    code: 'JOB-1003',
    builder: 'Trumark Homes',
    community: 'Stonebrook',
    phase: '1',
    building: '1',
    lotFrom: '7',
    lotTo: '',
  },
  {
    id: 4,
    code: 'JOB-1004',
    builder: 'Brookfield Residential',
    community: 'Marlow',
    phase: '3',
    building: '2',
    lotFrom: '30',
    lotTo: '36',
  },
]

export const emptyJob = {
  builder: '',
  community: '',
  phase: '',
  building: '',
  lotFrom: '',
  lotTo: '',
}

export function formatLotRange(job) {
  return job.lotTo && job.lotTo !== job.lotFrom
    ? `${job.lotFrom}–${job.lotTo}`
    : job.lotFrom
}

export function getJobUnitCount(job) {
  const start = Number(job.lotFrom)
  const end = Number(job.lotTo || job.lotFrom)

  return end - start + 1
}

export function formatJobHierarchy(job) {
  return [
    job.builder,
    job.community,
    job.phase && `Phase ${job.phase}`,
    job.building && `Building ${job.building}`,
    job.lotFrom && `Lot ${formatLotRange(job)}`,
  ]
    .filter(Boolean)
    .join(' / ')
}
