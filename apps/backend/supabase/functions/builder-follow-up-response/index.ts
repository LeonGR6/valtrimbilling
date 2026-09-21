import {
  verifyBuilderFollowUpResponseToken,
} from '../_shared/builderFollowUpResponse.ts'
import { handlePreflight, json } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/supabase.ts'

type ResponseAction = 'view' | 'submit'

interface ResponseBody {
  action?: ResponseAction
  token?: string
  response?: 'CONFIRMED' | 'NOT_READY'
  proposedWorkDate?: string | null
  reason?: string | null
}

function responseSecret() {
  const value = Deno.env.get('FOLLOW_UP_RESPONSE_SECRET')?.trim()
  if (!value) throw new Error('Builder follow-up responses are not configured.')
  return value
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500)
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message).slice(0, 500)
  }
  return 'The follow-up response could not be processed.'
}

function publicError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : ''
  if (code === 'P0002') {
    return {
      status: 410,
      message: 'This response link is expired or no longer valid. Please contact ValTrim scheduling.',
    }
  }
  if (['22023', '23505', '23514'].includes(code)) {
    return { status: 400, message: safeError(error) }
  }
  return { status: 500, message: 'The response could not be saved. Please try again.' }
}

function tokenValue(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > 160) return null
  return normalized
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const body = await req.json().catch(() => ({})) as ResponseBody
    const action = body.action ?? 'view'
    if (!['view', 'submit'].includes(action)) {
      return json({ error: 'Select a supported response action.' }, 400)
    }

    const token = tokenValue(body.token)
    if (!token) {
      return json({ error: 'This response link is invalid.' }, 400)
    }

    const publicId = await verifyBuilderFollowUpResponseToken(token, responseSecret())
    if (!publicId) {
      return json({
        error: 'This response link is invalid. Please use the complete link from the email.',
      }, 400)
    }

    const admin = serviceClient()
    if (action === 'view') {
      const { data, error } = await admin.rpc('get_builder_follow_up_response', {
        p_public_id: publicId,
      })
      if (error) throw error
      return json({ response: data })
    }

    const response = String(body.response ?? '').trim().toUpperCase()
    if (!['CONFIRMED', 'NOT_READY'].includes(response)) {
      return json({ error: 'Select Confirmed or Not ready.' }, 400)
    }

    const proposedWorkDate = body.proposedWorkDate
      ? String(body.proposedWorkDate).trim()
      : null
    if (proposedWorkDate && !/^\d{4}-\d{2}-\d{2}$/u.test(proposedWorkDate)) {
      return json({ error: 'Select a valid requested date.' }, 400)
    }

    const reason = body.reason ? String(body.reason).trim() : null
    if (reason && reason.length > 500) {
      return json({ error: 'The readiness note must contain 500 characters or fewer.' }, 400)
    }

    const { data, error } = await admin.rpc('submit_builder_follow_up_response', {
      p_public_id: publicId,
      p_response: response,
      p_proposed_work_date: proposedWorkDate,
      p_reason: reason,
    })
    if (error) throw error
    return json({ response: data })
  } catch (error) {
    console.error('Public Builder follow-up response failed:', error)
    const failure = publicError(error)
    return json({ error: failure.message }, failure.status)
  }
})
