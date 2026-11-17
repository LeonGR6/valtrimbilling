-- The DM reminder has no test or live modes any more: the person sending it chooses who it
-- goes to, and may send it again. The table is now just the record of every send, so the
-- screen can say when a DM was last announced.
--
-- Dropping `mode` also drops its check and the partial unique index that stopped a second
-- send of the same DM and day.

begin;

alter table valtrim.dm_reminder_emails drop column mode;

comment on table valtrim.dm_reminder_emails is
  'Record of every DM reminder email sent (Supervisor and Project Manager, the day before a DM). Written only by the dm-reminder-email Edge Function.';

commit;

notify pgrst, 'reload schema';
