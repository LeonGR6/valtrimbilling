import assert from 'node:assert/strict'
import test from 'node:test'
import {
  followUpDeliveryLabel,
  followUpLotsLabel,
  toBuilderFollowUpItem,
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
