const RESPONSE_ACTIONS = new Set(['CONFIRMED', 'NOT_READY'])

function requiredString(value, field) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`The follow-up response ${field} is missing.`)
  return normalized
}

export function toBuilderFollowUpPublicResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('The follow-up response is invalid.')
  }

  if (payload.alreadySubmitted) {
    const responseAction = requiredString(payload.responseAction, 'action')
    if (!RESPONSE_ACTIONS.has(responseAction)) {
      throw new Error('The follow-up response action is invalid.')
    }
    return {
      alreadySubmitted: true,
      responseAction,
      respondedAt: payload.respondedAt ?? null,
      workDate: requiredString(payload.workDate, 'work date'),
      proposedWorkDate: payload.proposedWorkDate
        ? String(payload.proposedWorkDate)
        : null,
      requestStatus: payload.requestStatus ? String(payload.requestStatus) : null,
      requestId: payload.requestId ? String(payload.requestId) : null,
      recipientName: payload.recipientName ? String(payload.recipientName) : '',
    }
  }

  return {
    alreadySubmitted: false,
    scheduleId: requiredString(payload.scheduleId, 'schedule id'),
    checkpointId: requiredString(payload.checkpointId, 'checkpoint id'),
    stageType: requiredString(payload.stageType, 'stage type'),
    variant: requiredString(payload.variant, 'variant'),
    workDate: requiredString(payload.workDate, 'work date'),
    minimumProposedDate: requiredString(
      payload.minimumProposedDate,
      'minimum requested date',
    ),
    lotStartLabel: String(payload.lotStartLabel ?? '').trim(),
    lotEndLabel: String(payload.lotEndLabel ?? '').trim(),
    jobCode: requiredString(payload.jobCode, 'Job code'),
    community: String(payload.community ?? '').trim(),
    builderName: requiredString(payload.builderName, 'Builder'),
    phaseCode: requiredString(payload.phaseCode, 'Phase'),
    building: String(payload.building ?? '').trim(),
    recipientName: requiredString(payload.recipientName, 'recipient'),
    expiresAt: payload.expiresAt ?? null,
  }
}
