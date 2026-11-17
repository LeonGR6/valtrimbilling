-- Writing the PO / CO # of an Extra / Change Order after it was approved, against the real database, inside a
-- transaction that is rolled back. Run it after the migration; every row of the last result must have
-- ok = true.
-- It makes Extras / COs of its own with fixed numbers (CO-TEST-91-...) and borrows one READ_ONLY user as
-- PROJECT_MANAGEMENT; nothing is left. The CO number sequence is not used (the numbers are given), and the
-- script checks it is as it found it.

begin;

create temporary table sp_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table sp_ctx (
  admin_id uuid,
  reader_id uuid,
  pm_id uuid,
  job_id bigint,
  builder_id bigint,
  seq_last bigint,
  seq_called boolean
) on commit drop;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into sp_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
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

-- The same as the signed-in user, but for a statement that returns nothing.
create function pg_temp.run_call(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql;
    reset role;
    return 'ok';
  exception when others then
    reset role;
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

insert into sp_ctx (admin_id, reader_id, pm_id, job_id, builder_id, seq_last, seq_called)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at desc limit 1),
  job.id,
  job.builder_id,
  (select last_value from valtrim.change_order_number_seq),
  (select is_called from valtrim.change_order_number_seq)
from valtrim.jobs job
where job.is_active
order by job.id
limit 1;

-- The reader and the PM must be two different people for the checks to mean something.
update valtrim.app_users set role = 'PROJECT_MANAGEMENT' where id = (select pm_id from sp_ctx);

select pg_temp.check_that('the validation has an Admin, a Project Manager, a reader and a Job',
  (select admin_id is not null and reader_id is not null and pm_id is not null and reader_id <> pm_id
          and job_id is not null from sp_ctx)
);

-- One Extra / CO in each status.
insert into valtrim.change_orders (change_order_number, title, builder_id, job_id, requested_by, status, po_co_number)
select n, 'Set PO ' || n, builder_id, job_id, 'Validation', 'DRAFT', null
from sp_ctx, unnest(array['CO-TEST-91-D', 'CO-TEST-91-P', 'CO-TEST-91-A', 'CO-TEST-91-C', 'CO-TEST-91-X']) n;

update valtrim.change_orders set status = 'PENDING' where change_order_number = 'CO-TEST-91-P';

update valtrim.change_orders
set status = 'APPROVED', approved_at = now(), approved_by = (select admin_id from sp_ctx)
where change_order_number = 'CO-TEST-91-A';

update valtrim.change_orders
set status = 'CANCELLED', cancelled_at = now(), cancelled_by = (select admin_id from sp_ctx), cancel_reason = 'Validation'
where change_order_number = 'CO-TEST-91-C';

-- The one that is approved and has a PO / CO # already, to change and clear it.
update valtrim.change_orders
set status = 'APPROVED', approved_at = now(), approved_by = (select admin_id from sp_ctx), po_co_number = 'OLD-1'
where change_order_number = 'CO-TEST-91-X';

create temporary table sp_orders on commit drop as
select change_order_number as label, id from valtrim.change_orders where change_order_number like 'CO-TEST-91-%';

select pg_temp.check_that('there is an Extra / CO in each status to work with',
  (select count(*) from sp_orders) = 5
  and (select status from valtrim.change_orders where change_order_number = 'CO-TEST-91-D') = 'DRAFT'
  and (select status from valtrim.change_orders where change_order_number = 'CO-TEST-91-P') = 'PENDING'
  and (select status from valtrim.change_orders where change_order_number = 'CO-TEST-91-A') = 'APPROVED'
  and (select status from valtrim.change_orders where change_order_number = 'CO-TEST-91-C') = 'CANCELLED'
);

-- Control: the form's own function still refuses an approved CO (nothing about it changed).
select pg_temp.check_that('the form still refuses to edit an approved Extra / CO',
  pg_temp.run_call(
    (select admin_id from sp_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'x', 'Validation',
        '[]'::jsonb)$q$,
      (select id from sp_orders where label = 'CO-TEST-91-A'), (select job_id from sp_ctx))
  ) like 'err:23514:%'
);

-- Writing it ------------------------------------------------------------------------------------------------
-- Each change is made in a statement of its own and looked at in the next one: a statement does not see
-- what a function it calls writes while it runs.

create temporary table sp_outcomes (
  label text primary key,
  outcome text
) on commit drop;

insert into sp_outcomes
select 'approved', pg_temp.run_call(
  (select admin_id from sp_ctx),
  format($q$select valtrim.set_change_order_po_co_number(%s, E' CO#  4400102/247 ')$q$,
    (select id from sp_orders where label = 'CO-TEST-91-A'))
);

select pg_temp.check_that('an Admin writes the PO / CO # of an approved Extra / CO, cleaned',
  (select outcome from sp_outcomes where label = 'approved') = 'ok'
  and (select po_co_number from valtrim.change_orders where change_order_number = 'CO-TEST-91-A') = 'CO# 4400102/247',
  (select outcome from sp_outcomes where label = 'approved')
);

select pg_temp.check_that('the CO stays approved, with the same approval, and nothing else of it changed',
  (select status = 'APPROVED' and approved_by = (select admin_id from sp_ctx) and title = 'Set PO CO-TEST-91-A'
          and requested_by = 'Validation' and job_id = (select job_id from sp_ctx)
   from valtrim.change_orders where change_order_number = 'CO-TEST-91-A')
  and (select count(*) from valtrim.change_order_status_history
       where change_order_id = (select id from sp_orders where label = 'CO-TEST-91-A')) = 2
);

select pg_temp.check_that('the CO says who changed it last',
  (select updated_by = (select admin_id from sp_ctx) from valtrim.change_orders where change_order_number = 'CO-TEST-91-A')
);

insert into sp_outcomes
select 'draft by pm', pg_temp.run_call(
  (select pm_id from sp_ctx),
  format($q$select valtrim.set_change_order_po_co_number(%s, '1277447-000')$q$,
    (select id from sp_orders where label = 'CO-TEST-91-D'))
);

select pg_temp.check_that('a Project Manager writes it on a Draft',
  (select outcome from sp_outcomes where label = 'draft by pm') = 'ok'
  and (select po_co_number from valtrim.change_orders where change_order_number = 'CO-TEST-91-D') = '1277447-000',
  (select outcome from sp_outcomes where label = 'draft by pm')
);

insert into sp_outcomes
select 'pending by pm', pg_temp.run_call(
  (select pm_id from sp_ctx),
  format($q$select valtrim.set_change_order_po_co_number(%s, 'M2068526708')$q$,
    (select id from sp_orders where label = 'CO-TEST-91-P'))
);

select pg_temp.check_that('a Project Manager writes it on a Pending one',
  (select outcome from sp_outcomes where label = 'pending by pm') = 'ok'
  and (select po_co_number from valtrim.change_orders where change_order_number = 'CO-TEST-91-P') = 'M2068526708',
  (select outcome from sp_outcomes where label = 'pending by pm')
);

insert into sp_outcomes
select 'approved by pm', pg_temp.run_call(
  (select pm_id from sp_ctx),
  format($q$select valtrim.set_change_order_po_co_number(%s, '4010-C-003232')$q$,
    (select id from sp_orders where label = 'CO-TEST-91-X'))
);

select pg_temp.check_that('a Project Manager changes it on an approved one (an Admin is not needed)',
  (select outcome from sp_outcomes where label = 'approved by pm') = 'ok'
  and (select po_co_number from valtrim.change_orders where change_order_number = 'CO-TEST-91-X') = '4010-C-003232',
  (select outcome from sp_outcomes where label = 'approved by pm')
);

insert into sp_outcomes
select 'clear', pg_temp.run_call(
  (select admin_id from sp_ctx),
  format($q$select valtrim.set_change_order_po_co_number(%s, E'  \t ')$q$,
    (select id from sp_orders where label = 'CO-TEST-91-X'))
);

select pg_temp.check_that('writing nothing clears the PO / CO #',
  (select outcome from sp_outcomes where label = 'clear') = 'ok'
  and (select po_co_number is null from valtrim.change_orders where change_order_number = 'CO-TEST-91-X'),
  (select outcome from sp_outcomes where label = 'clear')
);

update valtrim.change_orders set po_co_number = 'KEEP-ME' where change_order_number = 'CO-TEST-91-A';

insert into sp_outcomes
select 'too long', pg_temp.run_call(
  (select admin_id from sp_ctx),
  format($q$select valtrim.set_change_order_po_co_number(%s, repeat('9', 61))$q$,
    (select id from sp_orders where label = 'CO-TEST-91-A'))
);

select pg_temp.check_that('more than 60 characters is refused and the old one stays',
  (select outcome from sp_outcomes where label = 'too long')
    = 'err:23514:The PO / CO # must contain 60 characters or fewer'
  and (select po_co_number from valtrim.change_orders where change_order_number = 'CO-TEST-91-A') = 'KEEP-ME',
  (select outcome from sp_outcomes where label = 'too long')
);

select pg_temp.check_that('60 characters are accepted',
  pg_temp.run_call(
    (select admin_id from sp_ctx),
    format($q$select valtrim.set_change_order_po_co_number(%s, repeat('9', 60))$q$,
      (select id from sp_orders where label = 'CO-TEST-91-A'))
  ) = 'ok'
);

-- Who cannot -------------------------------------------------------------------------------------------------

update valtrim.change_orders set po_co_number = 'KEEP-ME' where change_order_number = 'CO-TEST-91-A';

insert into sp_outcomes
select 'cancelled', pg_temp.run_call(
  (select admin_id from sp_ctx),
  format($q$select valtrim.set_change_order_po_co_number(%s, 'NEW-ONE')$q$,
    (select id from sp_orders where label = 'CO-TEST-91-C'))
);

select pg_temp.check_that('a cancelled Extra / CO keeps what it had, even for an Admin',
  (select outcome from sp_outcomes where label = 'cancelled')
    = 'err:23514:The PO / CO # of a cancelled Change Order cannot be changed'
  and (select po_co_number is null from valtrim.change_orders where change_order_number = 'CO-TEST-91-C'),
  (select outcome from sp_outcomes where label = 'cancelled')
);

insert into sp_outcomes
select 'reader', pg_temp.run_call(
  (select reader_id from sp_ctx),
  format($q$select valtrim.set_change_order_po_co_number(%s, 'NOPE')$q$,
    (select id from sp_orders where label = 'CO-TEST-91-A'))
);

select pg_temp.check_that('someone who cannot edit Extras / COs cannot write the PO / CO # either',
  (select outcome from sp_outcomes where label = 'reader') like 'err:42501:%'
  and (select po_co_number from valtrim.change_orders where change_order_number = 'CO-TEST-91-A') = 'KEEP-ME',
  (select outcome from sp_outcomes where label = 'reader')
);

select pg_temp.check_that('an Extra / CO that does not exist says so',
  pg_temp.run_call(
    (select admin_id from sp_ctx),
    $q$select valtrim.set_change_order_po_co_number(-1, 'X')$q$
  ) = 'err:P0002:The Change Order no longer exists'
);

select pg_temp.check_that('there is one function in each schema, and only signed-in users call them',
  (select count(*) from pg_proc
   where proname = 'set_change_order_po_co_number'
     and pronamespace in ('valtrim'::regnamespace, 'private'::regnamespace)) = 2
  and has_function_privilege('authenticated', 'valtrim.set_change_order_po_co_number(bigint, text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.set_change_order_po_co_number(bigint, text)', 'execute')
  and not has_function_privilege('anon', 'private.set_change_order_po_co_number(bigint, text)', 'execute')
);

select pg_temp.check_that('the number sequence was not used',
  (select last_value from valtrim.change_order_number_seq) = (select seq_last from sp_ctx)
  and (select is_called from valtrim.change_order_number_seq) = (select seq_called from sp_ctx)
);

select step, name, ok, detail from sp_results order by step;

rollback;
