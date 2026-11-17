-- The record of the emails sent to Scheduling about an Extra / Change Order, against the real database,
-- inside a transaction that is rolled back. Run it after the migration; every row of the last result
-- must have ok = true. It makes one Draft Extra / CO of its own (with a fixed number, so no number of the
-- sequence is used) on an existing Job, and leaves nothing behind.

begin;

create temporary table em_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table em_ctx (
  admin_id uuid,
  job_id bigint,
  builder_id bigint,
  co_id bigint
) on commit drop;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into em_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

create function pg_temp.run_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql into v_result;
    reset role;
    return 'ok:' || coalesce(v_result, '');
  exception when others then
    reset role;
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

-- The same as the table owner, so only the constraints stand in the way.
create function pg_temp.run_sql(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok:';
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end;
$$;

insert into em_ctx (admin_id, job_id, builder_id)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  job.id,
  job.builder_id
from valtrim.jobs job
where job.is_active
order by job.id
limit 1;

insert into valtrim.change_orders (change_order_number, title, builder_id, job_id, requested_by, status)
select 'CO-TEST-88', 'Record of the emails to Scheduling', builder_id, job_id, 'Validation', 'DRAFT'
from em_ctx;

update em_ctx set co_id = (select id from valtrim.change_orders where change_order_number = 'CO-TEST-88');

select pg_temp.check_that('the validation has an Admin, a Job and an Extra / CO to work with',
  (select admin_id is not null and job_id is not null and co_id is not null from em_ctx));

-- Constraints -----------------------------------------------------------------------------------------

select pg_temp.check_that('a send with an EXT event, one lot and one recipient is recorded',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (%s, array['EXT'], 1, array['sam@valtriminc.com'], 'Extra / Change Order CO-TEST-88')$q$,
    (select co_id from em_ctx))) = 'ok:');

select pg_temp.check_that('an event that is not EXT, DM or HW is refused',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (%s, array['NONE'], 1, array['a@b.co'], 'x')$q$,
    (select co_id from em_ctx))) like 'err:23514:%');

select pg_temp.check_that('no event at all is refused',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (%s, array[]::text[], 1, array['a@b.co'], 'x')$q$,
    (select co_id from em_ctx))) like 'err:23514:%');

select pg_temp.check_that('a send with no lot is refused',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (%s, array['DM'], 0, array['a@b.co'], 'x')$q$,
    (select co_id from em_ctx))) like 'err:23514:%');

select pg_temp.check_that('a send with no recipient is refused',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (%s, array['DM'], 1, array[]::text[], 'x')$q$,
    (select co_id from em_ctx))) like 'err:23514:%');

select pg_temp.check_that('a send with more than ten recipients is refused',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (%s, array['DM'], 1, array_fill('a@b.co'::text, array[11]), 'x')$q$,
    (select co_id from em_ctx))) like 'err:23514:%');

select pg_temp.check_that('an empty subject is refused',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (%s, array['HW'], 1, array['a@b.co'], '')$q$,
    (select co_id from em_ctx))) like 'err:23514:%');

select pg_temp.check_that('a send for an Extra / CO that does not exist is refused',
  pg_temp.run_sql(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (-1, array['HW'], 1, array['a@b.co'], 'x')$q$) like 'err:23503:%');

-- Who can read and who can write ------------------------------------------------------------------------

select pg_temp.check_that('a signed-in user can read the record',
  pg_temp.run_as((select admin_id from em_ctx),
    'select count(*)::text from valtrim.change_order_event_emails') = 'ok:1');

select pg_temp.check_that('a signed-in user cannot write the record: only the Edge Function does',
  pg_temp.run_as((select admin_id from em_ctx), format(
    $q$insert into valtrim.change_order_event_emails (change_order_id, events, lot_count, recipients, subject)
       values (%s, array['EXT'], 1, array['a@b.co'], 'x')$q$,
    (select co_id from em_ctx))) like 'err:42501:%');

select pg_temp.check_that('the privileges are: read for signed-in users, none for anonymous ones, all for the service role',
  has_table_privilege('authenticated', 'valtrim.change_order_event_emails', 'select')
  and not has_table_privilege('authenticated', 'valtrim.change_order_event_emails', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.change_order_event_emails', 'update')
  and not has_table_privilege('authenticated', 'valtrim.change_order_event_emails', 'delete')
  and not has_table_privilege('anon', 'valtrim.change_order_event_emails', 'select')
  and has_table_privilege('service_role', 'valtrim.change_order_event_emails', 'insert')
);

select pg_temp.check_that('row level security is on',
  (select relrowsecurity from pg_class where oid = 'valtrim.change_order_event_emails'::regclass));

-- A Draft that is deleted takes its record with it -----------------------------------------------------------

select pg_temp.check_that('an Admin can delete the Draft that has a record',
  pg_temp.run_as((select admin_id from em_ctx),
    format('select valtrim.delete_change_order(%s)::text', (select co_id from em_ctx))) = 'ok:');

select pg_temp.check_that('the record went with the Draft',
  not exists (
    select 1 from valtrim.change_order_event_emails where change_order_id = (select co_id from em_ctx)
  )
);

select step, name, ok, detail from em_results order by step;

rollback;
