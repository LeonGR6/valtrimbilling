import { requireSupabase } from '../../../services/api.js'

// The community and Builder the email import read for a request, after combining the email
// text and its PDF (the PDF wins). The review offers to remember the community as a name of
// the Job the coordinator picks, only for that Builder (26 Nov 2026). Only ADMIN and
// SCHEDULING read it; an empty object means there is nothing to offer.
export async function readImportedProperty(requestId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('read_customer_service_import_property', {
    p_request_id: Number(requestId),
  })
  if (error) throw new Error(error.message || 'The imported property could not be read.', { cause: error })
  return {
    communityName: typeof data?.communityName === 'string' ? data.communityName : '',
    builderName: typeof data?.builderName === 'string' ? data.builderName : '',
  }
}
