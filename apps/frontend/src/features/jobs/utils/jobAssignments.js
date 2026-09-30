function assignedName(records, id, isEligible) {
  if (id == null) return ''

  return records.find((record) => (
    String(record.id) === String(id) && isEligible(record)
  ))?.name?.trim() ?? ''
}

export function resolveJobAssignmentNames(job, people = [], builderContacts = []) {
  return {
    supervisor: assignedName(
      people,
      job?.supervisorId,
      (person) => person.types?.includes('SUPERVISOR'),
    ),
    jobsiteSuperintendent: assignedName(
      builderContacts,
      job?.superintendentId,
      (contact) => contact.type === 'JOBSITE_SUPERINTENDENT',
    ),
  }
}
