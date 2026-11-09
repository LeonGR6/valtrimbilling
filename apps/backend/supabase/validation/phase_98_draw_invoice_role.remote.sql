-- The DRAW_INVOICE role against the real database, inside a transaction that is rolled back. Run it after the
-- migration 20261212120000; every row of the last result must have ok = true.
--
-- Nobody holds the role yet, so one of the READ_ONLY users plays it for the length of the transaction (the other
-- READ_ONLY user is the control that still cannot write). It checks that the role works in Draw & Invoice (it passes
-- the role gate of the Package functions and of the notes), that it still reads the rest of the app, and that
-- Builder Setup, prices and the Calendar answer "permission denied" (42501).

begin;

create temporary table qt_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table qt_ctx (
  draw_user uuid,
  control_user uuid,
  job_id bigint,
  builder_id bigint,
  plan_id bigint,
  phase_id bigint,
  package_id bigint
) on commit drop;

create temporary table qt_out (name text primary key, outcome text) on commit drop;

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

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into qt_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

insert into qt_ctx (draw_user, control_user, job_id, builder_id, plan_id, phase_id, package_id)
select
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at desc limit 1),
  (select id from valtrim.jobs where is_active order by id limit 1),
  (select id from valtrim.builders order by id limit 1),
  (select id from valtrim.plans order by id limit 1),
  (select id from valtrim.phases order by id limit 1),
  (select id from valtrim.draw_packages order by id limit 1);

select pg_temp.check_that(
  'there are two READ_ONLY users, a Job, a Builder, a Plan and a Phase to test with',
  (select draw_user is not null and control_user is not null and draw_user <> control_user
     and job_id is not null and builder_id is not null and plan_id is not null and phase_id is not null
   from qt_ctx),
  (select row_to_json(qt_ctx)::text from qt_ctx)
);

update valtrim.app_users set role = 'DRAW_INVOICE' where id = (select draw_user from qt_ctx);

select pg_temp.check_that(
  'the user now holds the DRAW_INVOICE role',
  (select role::text = 'DRAW_INVOICE' from valtrim.app_users where id = (select draw_user from qt_ctx)),
  null
);

-- Draw & Invoice: allowed -----------------------------------------------------------------------------------------------

insert into qt_out
select 'note', pg_temp.run_as(draw_user, format('select valtrim.add_job_note(%s, ''Draw & Invoice role check'')::text', job_id))
from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE adds a Job note',
  (select outcome like 'ok:%' from qt_out where name = 'note'),
  (select outcome from qt_out where name = 'note')
);

insert into qt_out
select 'control note', pg_temp.run_as(control_user, format('select valtrim.add_job_note(%s, ''Not allowed'')::text', job_id))
from qt_ctx;
select pg_temp.check_that(
  'the READ_ONLY control cannot add a Job note',
  (select outcome like 'err:42501:%' from qt_out where name = 'control note'),
  (select outcome from qt_out where name = 'control note')
);

select pg_temp.check_that(
  'DRAW_INVOICE reads the Job notes and READ_ONLY does not',
  (select pg_temp.run_as(draw_user, 'select count(*)::text from valtrim.job_notes') <> 'ok:0' from qt_ctx)
  and (select pg_temp.run_as(control_user, 'select count(*)::text from valtrim.job_notes') = 'ok:0' from qt_ctx),
  (select pg_temp.run_as(draw_user, 'select count(*)::text from valtrim.job_notes') from qt_ctx)
);

-- The role gate of the Package functions lets it through: what comes back is the validation of the (empty) request.
insert into qt_out
select 'create draw', pg_temp.run_as(
  draw_user,
  format('select valtrim.create_draw_invoice_package(%s, ''[]''::jsonb, current_date, null)::text', job_id)
) from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE passes the role gate of create_draw_invoice_package',
  (select outcome not like 'err:42501:%' from qt_out where name = 'create draw'),
  (select outcome from qt_out where name = 'create draw')
);

insert into qt_out
select 'create options', pg_temp.run_as(
  draw_user,
  format('select valtrim.create_options_package(%s, ''[]''::jsonb, current_date, null)::text', job_id)
) from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE passes the role gate of create_options_package',
  (select outcome not like 'err:42501:%' from qt_out where name = 'create options'),
  (select outcome from qt_out where name = 'create options')
);

insert into qt_out
select 'control create', pg_temp.run_as(
  control_user,
  format('select valtrim.create_draw_invoice_package(%s, ''[]''::jsonb, current_date, null)::text', job_id)
) from qt_ctx;
select pg_temp.check_that(
  'the READ_ONLY control is stopped at the role gate of create_draw_invoice_package',
  (select outcome like 'err:42501:%' from qt_out where name = 'control create'),
  (select outcome from qt_out where name = 'control create')
);

insert into qt_out
select 'workflow', pg_temp.run_as(
  draw_user,
  format('select valtrim.set_draw_package_workflow_status(%s, ''DRAFT'')::text', package_id)
) from qt_ctx where package_id is not null;
select pg_temp.check_that(
  'DRAW_INVOICE passes the role gate of set_draw_package_workflow_status (or there is no Package to try)',
  coalesce((select outcome not like 'err:42501:%' from qt_out where name = 'workflow'), true),
  (select outcome from qt_out where name = 'workflow')
);

-- Everything else: closed ------------------------------------------------------------------------------------------------

insert into qt_out
select 'builder setup', pg_temp.run_as(
  draw_user,
  format('select valtrim.save_builder_billing_setup(%s, ''{}''::jsonb, ''[]''::jsonb, ''[]''::jsonb)::text', builder_id)
) from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE cannot save a Builder Setup',
  (select outcome like 'err:42501:%' from qt_out where name = 'builder setup'),
  (select outcome from qt_out where name = 'builder setup')
);

insert into qt_out
select 'plan price', pg_temp.run_as(
  draw_user,
  format('select valtrim.set_plan_price(%s, 1, 1)::text', plan_id)
) from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE cannot set a Plan price',
  (select outcome like 'err:42501:%' from qt_out where name = 'plan price'),
  (select outcome from qt_out where name = 'plan price')
);

insert into qt_out
select 'calendar', pg_temp.run_as(
  draw_user,
  format('select valtrim.save_production_activity(null, %s, array[]::bigint[], ''[]''::jsonb, null)::text', phase_id)
) from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE cannot schedule the Calendar',
  (select outcome like 'err:42501:%' from qt_out where name = 'calendar'),
  (select outcome from qt_out where name = 'calendar')
);

-- Reading stays open ------------------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'DRAW_INVOICE still reads Jobs, like every other active user',
  (select pg_temp.run_as(draw_user, 'select count(*)::text from valtrim.jobs') <> 'ok:0'
     and pg_temp.run_as(draw_user, 'select count(*)::text from valtrim.jobs')
       = pg_temp.run_as(control_user, 'select count(*)::text from valtrim.jobs')
   from qt_ctx),
  (select pg_temp.run_as(draw_user, 'select count(*)::text from valtrim.jobs') from qt_ctx)
);

select step, name, ok, detail from qt_results order by step;

rollback;
