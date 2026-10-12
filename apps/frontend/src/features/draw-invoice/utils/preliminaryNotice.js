// A Job's first Package needs its Preliminary Notice uploaded first. Once the
// Job has any Package the notice was already there, so later Packages (and the
// Packages of a Job whose notice was deleted afterwards) are not checked again.
// The database enforces the same rule for signed-in users.

export const PRELIMINARY_NOTICE_DOCUMENT_TYPE = 'PRELIMINARY_NOTICE'

/** True when the Job has no Package yet, cancelled ones included. */
export function isFirstPackageOfJob(packages, jobId) {
  return !packages.some((record) => String(record.jobId) === String(jobId))
}

/**
 * Whether creating a Package for this Job must wait for the notice.
 * `hasNotice` is null while it is still being looked up.
 */
export function preliminaryNoticeGate({ jobId, packages, hasNotice }) {
  if (jobId == null || jobId === '') {
    return { required: false, status: 'not-needed', blocked: false }
  }

  if (!isFirstPackageOfJob(packages, jobId)) {
    return { required: false, status: 'not-needed', blocked: false }
  }

  if (hasNotice == null) return { required: true, status: 'loading', blocked: true }
  if (hasNotice) return { required: true, status: 'present', blocked: false }
  return { required: true, status: 'missing', blocked: true }
}
