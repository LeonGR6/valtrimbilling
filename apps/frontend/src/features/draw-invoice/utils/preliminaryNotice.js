// A Job needs its Preliminary Notice filled in before any Package can be created
// for it. A Job whose notice was deleted is blocked again until it is filled in.
// The database enforces the same rule for signed-in users.

export const PRELIMINARY_NOTICE_DOCUMENT_TYPE = 'PRELIMINARY_NOTICE'

/**
 * Whether creating a Package for this Job must wait for the notice.
 * `hasNotice` is null while it is still being looked up.
 */
export function preliminaryNoticeGate({ jobId, hasNotice }) {
  if (jobId == null || jobId === '') {
    return { required: false, status: 'not-needed', blocked: false }
  }

  if (hasNotice == null) return { required: true, status: 'loading', blocked: true }
  if (hasNotice) return { required: true, status: 'present', blocked: false }
  return { required: true, status: 'missing', blocked: true }
}
