function requiredId(value) {
  return Number(value)
}

export function toJobMutation(job) {
  return {
    code: job.code.trim().toUpperCase(),
    builder_id: requiredId(job.builderId),
    community: job.community.trim(),
    community_latitude: Number(job.communityLatitude),
    community_longitude: Number(job.communityLongitude),
    supervisor_id: requiredId(job.supervisorId),
    superintendent_id: requiredId(job.superintendentId),
  }
}

export function toJob(row) {
  return {
    id: row.id,
    code: row.code,
    builderId: row.builder_id,
    community: row.community,
    communityLatitude: Number(row.community_latitude),
    communityLongitude: Number(row.community_longitude),
    supervisorId: row.supervisor_id,
    superintendentId: row.superintendent_id,
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
