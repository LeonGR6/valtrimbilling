import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toBuilderFollowUpPublicResponse,
} from '../src/features/calendar/services/builderFollowUpPublicResponseRecord.js'

test('maps a pending public response without losing schedule identity', () => {
  const response = toBuilderFollowUpPublicResponse({
    alreadySubmitted: false,
    scheduleId: '101',
    checkpointId: '301',
    stageType: 'EXT',
    variant: 'BASE',
    workDate: '2026-10-15',
    minimumProposedDate: '2026-10-16',
    lotStartLabel: '1',
    lotEndLabel: '4',
    jobCode: 'JOB-01',
    community: 'River Walk',
    builderName: 'Acme Builder',
    phaseCode: '2',
    building: null,
    recipientName: 'Jamie Superintendent',
    expiresAt: '2026-10-16T00:00:00Z',
  })

  assert.equal(response.scheduleId, '101')
  assert.equal(response.minimumProposedDate, '2026-10-16')
  assert.equal(response.recipientName, 'Jamie Superintendent')
})

test('maps first-submit and idempotent response payloads without requiring pending fields', () => {
  const firstSubmit = toBuilderFollowUpPublicResponse({
    alreadySubmitted: false,
    scheduleId: '101',
    checkpointId: '301',
    responseAction: 'CONFIRMED',
    respondedAt: '2026-09-21T12:00:00Z',
    workDate: '2026-10-15',
    finalWorkDate: '2026-10-15',
    recipientName: 'Jamie Superintendent',
    notificationIds: ['801'],
  })
  assert.equal(firstSubmit.alreadySubmitted, true)
  assert.equal(firstSubmit.scheduleId, '101')
  assert.equal(firstSubmit.finalWorkDate, '2026-10-15')
  assert.deepEqual(firstSubmit.notificationIds, ['801'])

  const idempotent = toBuilderFollowUpPublicResponse({
    alreadySubmitted: true,
    scheduleId: '101',
    checkpointId: '301',
    responseAction: 'NOT_READY',
    respondedAt: '2026-09-21T12:00:00Z',
    workDate: '2026-10-15',
    proposedWorkDate: '2026-10-22',
    finalWorkDate: '2026-10-22',
    currentWorkDate: '2026-10-22',
    requestStatus: 'APPROVED',
    requestId: '701',
    recipientName: 'Jamie Superintendent',
  })
  assert.equal(idempotent.requestStatus, 'APPROVED')
  assert.equal(idempotent.finalWorkDate, '2026-10-22')
})

test('rejects an unknown submitted action', () => {
  assert.throws(() => toBuilderFollowUpPublicResponse({
    alreadySubmitted: true,
    responseAction: 'MAYBE',
    workDate: '2026-10-15',
  }), /action is invalid/)
})
