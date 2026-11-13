function requiredId(value) {
  return Number(value)
}

// A contact the Job may go without: empty stays null instead of becoming 0.
function optionalId(value) {
  return value === null || value === undefined || value === '' ? null : Number(value)
}

export function toJobMutation(job) {
  return {
    code: job.code.trim().toUpperCase(),
    builder_id: requiredId(job.builderId),
    community: job.community.trim(),
    supervisor_id: requiredId(job.supervisorId),
    superintendent_id: requiredId(job.superintendentId),
    estimator_id: optionalId(job.estimatorId),
    job_coordinator_id: optionalId(job.jobCoordinatorId),
    purchasing_id: optionalId(job.purchasingId),
    scheduling_id: optionalId(job.schedulingId),
    options_coordinator_id: optionalId(job.optionsCoordinatorId),
    project_manager_id: optionalId(job.projectManagerId),
  }
}

export function toJob(row) {
  return {
    id: row.id,
    code: row.code,
    builderId: row.builder_id,
    community: row.community,
    supervisorId: row.supervisor_id,
    superintendentId: row.superintendent_id,
    estimatorId: row.estimator_id,
    jobCoordinatorId: row.job_coordinator_id,
    purchasingId: row.purchasing_id,
    schedulingId: row.scheduling_id,
    optionsCoordinatorId: row.options_coordinator_id,
    projectManagerId: row.project_manager_id ?? null,
    billingSetupVersionId: row.billing_setup_version_id,
    sequenceSheetName: row.sequence_sheet_name ?? '',
    status: row.status,
    notes: row.notes ?? '',
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sequenceSheet: {
      name: row.sequence_sheet_name || 'Options Sequence Sheet',
      plans: [],
      phases: [],
    },
  }
}
