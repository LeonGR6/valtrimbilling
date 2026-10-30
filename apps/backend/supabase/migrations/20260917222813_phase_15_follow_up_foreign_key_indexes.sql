-- Cover the remaining Phase 15 foreign keys used by joins, provider result
-- reconciliation and parent-row lifecycle operations.

begin;

create index builder_follow_up_checkpoints_rule_idx
  on valtrim.builder_follow_up_checkpoints (rule_id);

create index builder_follow_up_emails_recipient_contact_idx
  on valtrim.builder_follow_up_emails (recipient_contact_id)
  where recipient_contact_id is not null;

create index builder_follow_up_events_checkpoint_idx
  on valtrim.builder_follow_up_events (checkpoint_id, action)
  where checkpoint_id is not null;

create index builder_follow_up_events_contact_idx
  on valtrim.builder_follow_up_events (contact_id)
  where contact_id is not null;

commit;
