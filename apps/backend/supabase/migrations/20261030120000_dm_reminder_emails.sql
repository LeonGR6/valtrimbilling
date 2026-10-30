-- The email that tells a Job's Supervisor and Project Manager, the day before, that a
-- DM is scheduled and which Sequence Sheet lots it covers.
--
-- This table is only the record of what was sent, so the same DM is never announced
-- twice. Browsers never write it: the dm-reminder-email Edge Function writes as
-- service_role after checking the caller's role, which is also what a scheduled run will
-- do once the emails go out on their own.
--
-- `mode` says how the email went out: TEST (to the test addresses only, nobody real
-- received it) or LIVE (to the Job's contacts). Only a LIVE send counts as "already
-- announced"; any number of TEST sends can be recorded for the same DM.

begin;

create table valtrim.dm_reminder_emails (
  id uuid primary key default gen_random_uuid(),
  -- Deleting a schedule (or its activity) removes its record.
  schedule_id bigint not null
    references valtrim.production_schedules(id) on delete cascade,
  -- The day of the DM when it was announced: moving the DM to another day makes it
  -- announceable again.
  event_date date not null,
  mode text not null check (mode in ('TEST', 'LIVE')),
  recipients text[] not null check (cardinality(recipients) between 1 and 10),
  subject text not null check (char_length(subject) between 1 and 200),
  provider_message_id text,
  sent_by uuid references valtrim.app_users(id) on delete set null,
  sent_at timestamptz not null default now()
);

create unique index dm_reminder_emails_live_once
  on valtrim.dm_reminder_emails (schedule_id, event_date)
  where mode = 'LIVE';

create index dm_reminder_emails_schedule_idx
  on valtrim.dm_reminder_emails (schedule_id, sent_at desc);

alter table valtrim.dm_reminder_emails enable row level security;

revoke all on valtrim.dm_reminder_emails from public, anon, authenticated;
grant select on valtrim.dm_reminder_emails to authenticated;
grant select, insert, update, delete on valtrim.dm_reminder_emails to service_role;

create policy dm_reminder_emails_select
on valtrim.dm_reminder_emails for select to authenticated
using ((select private.is_active_user()));

comment on table valtrim.dm_reminder_emails is
  'Record of the DM reminder emails (Supervisor and Project Manager, the day before a DM). Written only by the dm-reminder-email Edge Function.';

commit;

notify pgrst, 'reload schema';
