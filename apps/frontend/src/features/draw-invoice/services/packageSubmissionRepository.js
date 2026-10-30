// Sending a generated Package to the Builder by email.

import { requireSupabase } from '../../../services/api.js'
import { bytesToBase64, toPackageSubmission } from './packageSubmissionRecord.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'

const FUNCTION_NAME = 'package-submission-email'

export async function sendPackageSubmissionEmail({
  packageId,
  recipientEmails,
  subject,
  message,
  fileName,
  bytes,
  requestId,
}) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
    body: {
      packageId,
      recipientEmails,
      subject,
      message,
      fileName,
      pdfBase64: bytesToBase64(bytes),
      requestId,
    },
  })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The Package email could not be sent.'), { cause: error })
  }
  return data
}

/** The emails of a Package to its Builder, newest first. */
export async function listPackageSubmissions(packageId) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('package_submissions')
    .select('id, package_id, method, destination, subject, file_name, sent_at')
    .eq('package_id', packageId)
    .order('sent_at', { ascending: false })

  if (error) throw new Error(error.message || 'The sent emails could not be loaded.', { cause: error })
  return (data ?? []).map(toPackageSubmission)
}

/**
 * Moves a Package from Draft to Awaiting payment once it has been submitted
 * (printed to mail, or downloaded for the portal). A Package that is already
 * past Draft stays as it is. Returns the Package's status.
 */
export async function markPackageSubmitted(packageId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('mark_package_submitted', {
    p_package_id: Number(packageId),
  })
  if (error) {
    throw new Error(error.message || 'The Package status could not be updated.', { cause: error })
  }
  return data
}
