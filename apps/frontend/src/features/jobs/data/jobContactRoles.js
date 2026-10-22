// Contacts a Job points at, besides its Supervisor. Each role is a column on
// the Job. `source` says where the contact comes from: the Jobsite
// Superintendent works for the Builder and is picked from the contacts of the
// Job's Builder; the others are Company Contacts with the matching type. Only the
// Supervisor and the Jobsite Superintendent are required: the rest are `optional`.
export const jobContactRoles = [
  {
    field: 'superintendentId',
    source: 'builder',
    type: 'JOBSITE_SUPERINTENDENT',
    label: 'Jobsite Superintendent',
    addTitle: 'Add new superintendent',
    editTitle: 'Edit superintendent',
  },
  {
    field: 'estimatorId',
    source: 'company',
    type: 'ESTIMATOR',
    optional: true,
    label: 'Estimator',
    addTitle: 'Add new estimator',
    editTitle: 'Edit estimator',
  },
  {
    field: 'jobCoordinatorId',
    source: 'company',
    type: 'JOB_COORDINATOR',
    optional: true,
    label: 'Job Coordinator',
    addTitle: 'Add new job coordinator',
    editTitle: 'Edit job coordinator',
  },
  {
    field: 'purchasingId',
    source: 'company',
    type: 'PURCHASING',
    optional: true,
    label: 'Purchasing',
    addTitle: 'Add new purchasing contact',
    editTitle: 'Edit purchasing contact',
  },
  {
    field: 'schedulingId',
    source: 'company',
    type: 'SCHEDULING',
    optional: true,
    label: 'Scheduling',
    addTitle: 'Add new scheduling contact',
    editTitle: 'Edit scheduling contact',
  },
  {
    field: 'optionsCoordinatorId',
    source: 'company',
    type: 'OPTIONS_COORDINATOR',
    optional: true,
    label: 'Options Coordinator',
    addTitle: 'Add new options coordinator',
    editTitle: 'Edit options coordinator',
  },
  {
    field: 'projectManagerId',
    source: 'company',
    type: 'PROJECT_MANAGER',
    optional: true,
    label: 'Project Manager',
    addTitle: 'Add new project manager',
    editTitle: 'Edit project manager',
  },
]
