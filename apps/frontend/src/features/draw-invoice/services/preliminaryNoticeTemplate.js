// The California Preliminary Notice every Job starts from. It ships with the
// app, so nobody uploads it: the editor opens it blank for the Job and the
// filled copy is what gets saved.
import templateUrl from '../assets/california-preliminary-notice.pdf?url'

export const NOTICE_TEMPLATE_NAME = 'Preliminary Notice'

/** The name a Job's filled notice is saved under. */
export function noticeFileNameForJob(job) {
  return `${NOTICE_TEMPLATE_NAME} - Job ${job.code}.pdf`.replace(/[\\/]/g, '-')
}

export async function loadNoticeTemplate() {
  const response = await fetch(templateUrl)
  if (!response.ok) throw new Error('The Preliminary Notice form could not be loaded.')

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('The Preliminary Notice form could not be loaded.')
  }
  return bytes
}
