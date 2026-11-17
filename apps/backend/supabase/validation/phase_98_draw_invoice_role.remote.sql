-- The DRAW_INVOICE role against the real database, inside a transaction that is rolled back. Run it after the
-- migrations 20261212120000 and 20261213120000; every row of the last result must have ok = true.
--
-- The user that plays the role is a real DRAW_INVOICE user when there is one (else a READ_ONLY or ADMIN user, whose role is
-- changed for the length of the transaction). The control is a READ_ONLY user (else an ADMIN switched to READ_ONLY inside
-- the transaction) that must still be stopped everywhere the role is let through. It checks that the role works in Draw &
-- Invoice (it passes the role gate of the Package functions and of the notes), that it still reads the rest of the app, and
-- that Builder Setup, prices and the Calendar answer "permission denied" (42501). It also checks that the role can
-- choose the QuickBooks mode (Test or Production) while the control cannot, and that the setting still cannot be
-- written directly.

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
  package_id bigint,
  mode_before text,
  mode_target text
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

insert into qt_ctx (draw_user, control_user, job_id, builder_id, plan_id, phase_id, package_id, mode_before, mode_target)
select
  -- The user that plays the role: a real DRAW_INVOICE user first, then a READ_ONLY one, then an ADMIN.
  (select id from valtrim.app_users
   where is_active and role in ('DRAW_INVOICE', 'READ_ONLY', 'ADMIN')
   order by case role::text when 'DRAW_INVOICE' then 0 when 'READ_ONLY' then 1 else 2 end, created_at
   limit 1),
  -- The control: another READ_ONLY user first, else another ADMIN (switched to READ_ONLY below).
  (select candidate.id from valtrim.app_users candidate
   where candidate.is_active and candidate.role in ('READ_ONLY', 'ADMIN')
     and candidate.id is distinct from (
       select id from valtrim.app_users
       where is_active and role in ('DRAW_INVOICE', 'READ_ONLY', 'ADMIN')
       order by case role::text when 'DRAW_INVOICE' then 0 when 'READ_ONLY' then 1 else 2 end, created_at
       limit 1)
   order by case candidate.role::text when 'READ_ONLY' then 0 else 1 end, candidate.created_at desc
   limit 1),
  (select id from valtrim.jobs where is_active order by id limit 1),
  (select id from valtrim.builders order by id limit 1),
  (select id from valtrim.plans order by id limit 1),
  (select id from valtrim.phases order by id limit 1),
  (select id from valtrim.draw_packages order by id limit 1),
  (select active_environment from valtrim.quickbooks_settings where id),
  -- The other environment when it is connected and ready (the switch is then a real change); else the active one.
  coalesce(
    (select connection.environment
     from valtrim.quickbooks_connections connection
     where connection.status = 'CONNECTED'
       and connection.item_id is not null
       and connection.environment is distinct from (select active_environment from valtrim.quickbooks_settings where id)
     order by connection.environment
     limit 1),
    (select active_environment from valtrim.quickbooks_settings where id)
  );

select pg_temp.check_that(
  'there are two users (one plays the role, one is the READ_ONLY control), a Job, a Builder, a Plan and a Phase to test with',
  (select draw_user is not null and control_user is not null and draw_user <> control_user
     and job_id is not null and builder_id is not null and plan_id is not null and phase_id is not null
   from qt_ctx),
  (select row_to_json(qt_ctx)::text from qt_ctx)
);

update valtrim.app_users set role = 'DRAW_INVOICE' where id = (select draw_user from qt_ctx);
update valtrim.app_users set role = 'READ_ONLY' where id = (select control_user from qt_ctx);

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

-- QuickBooks mode ----------------------------------------------------------------------------------------------------------

insert into qt_out
select 'mode control', pg_temp.run_as(
  control_user,
  format('select valtrim.set_quickbooks_active_environment(%L)', mode_target)
) from qt_ctx;
select pg_temp.check_that(
  'the READ_ONLY control cannot choose the QuickBooks mode',
  (select outcome like 'err:42501:%' from qt_out where name = 'mode control'),
  (select outcome from qt_out where name = 'mode control')
);

select pg_temp.check_that(
  'the mode did not move after the control tried',
  (select active_environment = (select mode_before from qt_ctx) from valtrim.quickbooks_settings where id),
  null
);

insert into qt_out
select 'mode direct', pg_temp.run_as(
  draw_user,
  format('with changed as (update valtrim.quickbooks_settings set active_environment = %L where id returning 1) select count(*)::text from changed', mode_target)
) from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE cannot write the QuickBooks setting directly, only through the function',
  (select active_environment = (select mode_before from qt_ctx) from valtrim.quickbooks_settings where id),
  (select outcome from qt_out where name = 'mode direct')
);

insert into qt_out
select 'mode draw', pg_temp.run_as(
  draw_user,
  format('select valtrim.set_quickbooks_active_environment(%L)', mode_target)
) from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE chooses the QuickBooks mode',
  (select outcome = 'ok:' || (select mode_target from qt_ctx) from qt_out where name = 'mode draw'),
  (select outcome from qt_out where name = 'mode draw')
);

select pg_temp.check_that(
  'the QuickBooks mode is now the one DRAW_INVOICE chose',
  (select active_environment = (select mode_target from qt_ctx) from valtrim.quickbooks_settings where id),
  (select active_environment from valtrim.quickbooks_settings where id)
);

select pg_temp.check_that(
  'the change is in the QuickBooks mode log with the DRAW_INVOICE user (or the mode was already that one)',
  (select (select mode_before from qt_ctx) = (select mode_target from qt_ctx)
     or exists (
       select 1 from valtrim.quickbooks_environment_log log
       where log.changed_by = (select draw_user from qt_ctx)
         and log.environment = (select mode_target from qt_ctx)
     )),
  null
);

insert into qt_out
select 'mode wrong value', pg_temp.run_as(draw_user, 'select valtrim.set_quickbooks_active_environment(''staging'')')
from qt_ctx;
select pg_temp.check_that(
  'DRAW_INVOICE still gets "Choose Test or Production" for a value that is neither',
  (select outcome like 'err:22023:%' from qt_out where name = 'mode wrong value'),
  (select outcome from qt_out where name = 'mode wrong value')
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
