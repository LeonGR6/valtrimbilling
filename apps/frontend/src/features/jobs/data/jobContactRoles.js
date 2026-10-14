// Contacts a Job points at, besides its Supervisor. Each role is a column on
// the Job. `source` says where the contact comes from: the Jobsite
// Superintendent works for the Builder and is picked from the contacts of the
// Job's Builder; the others are Company Contacts with the matching type.
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
    label: 'Estimator',
    addTitle: 'Add new estimator',
    editTitle: 'Edit estimator',
  },
  {
    field: 'jobCoordinatorId',
    source: 'company',
    type: 'JOB_COORDINATOR',
    label: 'Job Coordinator',
    addTitle: 'Add new job coordinator',
    editTitle: 'Edit job coordinator',
  },
  {
    field: 'purchasingId',
    source: 'company',
    type: 'PURCHASING',
    label: 'Purchasing',
    addTitle: 'Add new purchasing contact',
    editTitle: 'Edit purchasing contact',
  },
  {
    field: 'schedulingId',
    source: 'company',
    type: 'SCHEDULING',
    label: 'Scheduling',
    addTitle: 'Add new scheduling contact',
    editTitle: 'Edit scheduling contact',
  },
  {
    field: 'optionsCoordinatorId',
    source: 'company',
    type: 'OPTIONS_COORDINATOR',
    label: 'Options Coordinator',
    addTitle: 'Add new options coordinator',
    editTitle: 'Edit options coordinator',
  },
]
