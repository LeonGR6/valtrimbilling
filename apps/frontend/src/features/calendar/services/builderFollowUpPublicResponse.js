import { requireSupabase } from '../../../services/api.js'
import { toBuilderFollowUpPublicResponse } from './builderFollowUpPublicResponseRecord.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'

const RESPONSE_FUNCTION = 'builder-follow-up-response'

async function invokeResponse(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(RESPONSE_FUNCTION, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The follow-up response request failed.'), { cause: error })
  }
  return toBuilderFollowUpPublicResponse(data?.response)
}

export function getBuilderFollowUpPublicResponse(token) {
  return invokeResponse({ action: 'view', token })
}

export function submitBuilderFollowUpPublicResponse({
  token,
  response,
  proposedWorkDate = null,
  reason = null,
}) {
  return invokeResponse({
    action: 'submit',
    token,
    response,
    proposedWorkDate,
    reason,
  })
}
