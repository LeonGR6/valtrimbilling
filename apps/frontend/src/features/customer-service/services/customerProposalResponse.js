import { requireSupabase } from '../../../services/api.js'

// The customer's page for a proposal (block B, step B5). No sign-in: the signed token
// from the email link is sent to the Edge Function, which only accepts it while the
// proposal waits for an answer. Opening the page only reads; each answer is a button.
const RESPONSE_FUNCTION = 'customer-service-proposal-response'

async function errorMessage(error, data) {
  if (data?.error) return data.error
  const payload = await error?.context?.clone?.().json().catch(() => null)
  return payload?.error || 'We could not reach Valtrim right now. Please try again or reply to the email.'
}

async function invoke(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(RESPONSE_FUNCTION, { body })
  if (error || data?.error || !data?.proposal) throw new Error(await errorMessage(error, data), { cause: error })
  return data.proposal
}

export const viewCustomerProposal = (token) => invoke({ action: 'view', token })
export const acceptCustomerProposal = (token, optionNumber) => invoke({ action: 'accept', token, optionNumber })
export const chooseCustomerAlternative = (token, alternative) => invoke({ action: 'choose', token, alternative })
// callBack: { bestTime, phone }, both optional (decided 23 Nov 2026).
export const declineCustomerProposal = (token, { bestTime = '', phone = '' } = {}) =>
  invoke({ action: 'none', token, bestTime, phone })
