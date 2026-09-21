import assert from 'node:assert/strict'
import test from 'node:test'
import {
  followUpDeliveryLabel,
  followUpEscalationLabel,
  followUpLotsLabel,
  toBuilderFollowUpAttentionItem,
  toBuilderFollowUpEscalationSettings,
  toBuilderFollowUpItem,
  toBuilderFollowUpRescheduleRequest,
  toFollowUpEmailResult,
} from '../src/features/calendar/services/builderFollowUpRecord.js'

const row = {
  checkpoint_id: 301,
  schedule_id: 101,
  checkpoint_code: 'FOUR_WEEKS',
  days_before: 28,
  stage_type: 'EXT',
  variant: 'BASE',
  work_date: '2026-10-15',
  due_on: '2026-09-17',
  checkpoint_status: 'PENDING',
  follow_up_status: 'SCHEDULED',
  job_code: 'JOB-01',
  community: 'River Walk',
  builder_name: 'Acme Builder',
  phase_code: '2',
  building: null,
  lot_start_label: '1',
  lot_end_label: '4',
  recipient_contact_id: 88,
  recipient_name: 'Jamie Superintendent',
  recipient_email: 'jamie@example.com',
  recipient_is_active: true,
  email_status: null,
  sent_at: null,
  last_error: null,
  delivery_status: 'OVERDUE',
  days_until_due: -2,
}

test('maps a follow-up queue row without losing bigint identities', () => {
  const item = toBuilderFollowUpItem(row)
  assert.equal(item.checkpointId, '301')
  assert.equal(item.scheduleId, '101')
  assert.equal(item.recipientEmail, 'jamie@example.com')
  assert.equal(followUpLotsLabel(item), 'Lots 1–4')
  assert.equal(followUpDeliveryLabel(item), '2 days overdue')
})

test('rejects unknown delivery states and invalid function modes', () => {
  assert.throws(() => toBuilderFollowUpItem({
    ...row,
    delivery_status: 'SENT_SOMEHOW',
  }), /delivery status is invalid/)
  assert.throws(() => toFollowUpEmailResult({ mode: 'ENABLED' }), /invalid mode/)
})

test('accepts explicit PREVIEW and LIVE Edge Function modes', () => {
  assert.equal(toFollowUpEmailResult({ mode: 'PREVIEW' }).mode, 'PREVIEW')
  assert.equal(toFollowUpEmailResult({ mode: 'LIVE' }).mode, 'LIVE')
})

test('maps the immediate no-response attention signal and internal escalation', () => {
  const attention = toBuilderFollowUpAttentionItem({
    escalation_id: 501,
    no_response_event_id: 401,
    schedule_id: 101,
    no_response_since: '2026-09-18T15:30:00Z',
    work_date: '2026-10-15',
    stage_type: 'EXT',
    variant: 'BASE',
    job_code: 'JOB-01',
    community: 'River Walk',
    builder_name: 'Acme Builder',
    phase_code: '2',
    building: 'B',
    lot_start_label: '1',
    lot_end_label: '4',
    superintendent_contact_id: 88,
    superintendent_name: 'Jamie Superintendent',
    superintendent_email: 'jamie@example.com',
    escalation_enabled: true,
    wait_business_days: 2,
    recipient_emails: ['andres@valtrim.com'],
    due_on: '2026-09-22',
    escalation_status: 'PENDING',
    sent_at: null,
    last_error: null,
    delivery_status: 'PENDING',
    days_until_due: 4,
  })

  assert.equal(attention.escalationId, '501')
  assert.equal(attention.noResponseEventId, '401')
  assert.deepEqual(attention.recipientEmails, ['andres@valtrim.com'])
  assert.equal(followUpEscalationLabel(attention), 'Internal alert in 4 days')
})

test('maps escalation settings and rejects missing internal recipients', () => {
  assert.deepEqual(toBuilderFollowUpEscalationSettings({
    is_enabled: true,
    wait_business_days: 2,
    recipient_emails: ['andres@valtrim.com'],
  }), {
    isEnabled: true,
    waitBusinessDays: 2,
    recipientEmails: ['andres@valtrim.com'],
  })
  assert.throws(() => toBuilderFollowUpEscalationSettings({
    is_enabled: true,
    wait_business_days: 2,
    recipient_emails: [],
  }), /recipients are missing/)
})

test('maps a Superintendent requested date for internal review', () => {
  const request = toBuilderFollowUpRescheduleRequest({
    request_id: 701,
    schedule_id: 101,
    target_work_date: '2026-10-15',
    current_work_date: '2026-10-15',
    proposed_work_date: '2026-10-22',
    requested_shift_days: 7,
    reason: 'Material delivery delayed',
    status: 'PENDING',
    submitted_at: '2026-09-21T12:00:00Z',
    superintendent_contact_id: 88,
    superintendent_name: 'Jamie Superintendent',
    superintendent_email: 'jamie@example.com',
    stage_type: 'EXT',
    variant: 'BASE',
    job_code: 'JOB-01',
    community: 'River Walk',
    builder_name: 'Acme Builder',
    phase_code: '2',
    building: 'B',
    lot_start_label: '1',
    lot_end_label: '4',
  })

  assert.equal(request.requestId, '701')
  assert.equal(request.requestedShiftDays, 7)
  assert.equal(request.reason, 'Material delivery delayed')
})
