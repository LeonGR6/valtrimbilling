-- The email that tells a Job's Scheduling contact which lots of an Extra / Change Order will be
-- charged with an event already on the Calendar (EXT, DM or HW).
--
-- This table is only the record of what was sent, so an Extra / CO can say when Scheduling was told
-- and who was written to. Browsers never write it: the change-order-event-email Edge Function writes
-- as service_role after checking the caller's role, the same way the DM reminder record is kept.

begin;

create table valtrim.change_order_event_emails (
  id uuid primary key default gen_random_uuid(),
  -- A Draft that is deleted takes its record with it.
  change_order_id bigint not null
    references valtrim.change_orders(id) on delete cascade,
  -- The Calendar events the email was about.
  events text[] not null
    check (cardinality(events) between 1 and 3 and events <@ array['EXT', 'DM', 'HW']),
  lot_count integer not null check (lot_count >= 1),
  recipients text[] not null check (cardinality(recipients) between 1 and 10),
  subject text not null check (char_length(subject) between 1 and 200),
  provider_message_id text,
  sent_by uuid references valtrim.app_users(id) on delete set null,
  sent_at timestamptz not null default now()
);

create index change_order_event_emails_change_order_idx
  on valtrim.change_order_event_emails (change_order_id, sent_at desc);

alter table valtrim.change_order_event_emails enable row level security;

revoke all on valtrim.change_order_event_emails from public, anon, authenticated;
grant select on valtrim.change_order_event_emails to authenticated;
grant select, insert, update, delete on valtrim.change_order_event_emails to service_role;

create policy change_order_event_emails_select
on valtrim.change_order_event_emails for select to authenticated
using ((select private.is_active_user()));

comment on table valtrim.change_order_event_emails is
  'Record of the emails that told a Job''s Scheduling contact which lots of an Extra / Change Order are charged with a Calendar event. Written only by the change-order-event-email Edge Function.';

commit;

notify pgrst, 'reload schema';
