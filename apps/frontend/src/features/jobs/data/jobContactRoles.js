// Builder contacts a Job points at. Each role is a column on the Job, filtered
// to the contacts of the Job's Builder with the matching type.
export const jobContactRoles = [
  {
    field: 'superintendentId',
    type: 'JOBSITE_SUPERINTENDENT',
    label: 'Jobsite Superintendent',
    helperText: 'Builder contact responsible for the jobsite.',
    addTitle: 'Add new superintendent',
    editTitle: 'Edit superintendent',
  },
  {
    field: 'estimatorId',
    type: 'ESTIMATOR',
    label: 'Estimator',
    helperText: 'Builder contact who prices the scope of work.',
    addTitle: 'Add new estimator',
    editTitle: 'Edit estimator',
  },
  {
    field: 'jobCoordinatorId',
    type: 'JOB_COORDINATOR',
    label: 'Job Coordinator',
    helperText: 'Builder contact who coordinates the job day to day.',
    addTitle: 'Add new job coordinator',
    editTitle: 'Edit job coordinator',
  },
  {
    field: 'purchasingId',
    type: 'PURCHASING',
    label: 'Purchasing',
    helperText: 'Builder contact who handles purchase orders.',
    addTitle: 'Add new purchasing contact',
    editTitle: 'Edit purchasing contact',
  },
  {
    field: 'schedulingId',
    type: 'SCHEDULING',
    label: 'Scheduling',
    helperText: 'Builder contact who confirms the production schedule.',
    addTitle: 'Add new scheduling contact',
    editTitle: 'Edit scheduling contact',
  },
  {
    field: 'optionsCoordinatorId',
    type: 'OPTIONS_COORDINATOR',
    label: 'Options Coordinator',
    helperText: 'Builder contact who manages the homebuyer options.',
    addTitle: 'Add new options coordinator',
    editTitle: 'Edit options coordinator',
  },
]
