import { requireSupabase } from '../../../services/api.js'
import { toBuilderFollowUpPublicResponse } from './builderFollowUpPublicResponseRecord.js'

const RESPONSE_FUNCTION = 'builder-follow-up-response'

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }
  return error?.message || 'The follow-up response request failed.'
}

async function invokeResponse(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(RESPONSE_FUNCTION, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
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
