-- The notes of the Plans and of the Options of a Job, against the real database, inside a transaction that is
-- rolled back. Run it after the migration 20261210120000; every row of the last result must have ok = true.
-- It writes notes as an ADMIN and checks who may add and read them, then leaves nothing behind.

begin;

create temporary table qt_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table qt_ctx (admin_id uuid, other_id uuid, other_role text, job_id bigint) on commit drop;

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

insert into qt_ctx (admin_id, other_id, other_role, job_id)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role not in ('ADMIN', 'PROJECT_MANAGEMENT') and is_active order by created_at limit 1),
  (select role::text from valtrim.app_users where role not in ('ADMIN', 'PROJECT_MANAGEMENT') and is_active order by created_at limit 1),
  (select id from valtrim.jobs order by id limit 1);

select pg_temp.check_that(
  'there is an ADMIN and a Job to test with',
  (select admin_id is not null and job_id is not null from qt_ctx)
);

-- The browser cannot write, edit or delete ---------------------------------------------------------------------------

select pg_temp.check_that(
  'the browser reads the notes but cannot write, edit or delete them, and anonymous users read nothing',
  has_column_privilege('authenticated', 'valtrim.plan_option_notes', 'body', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.plan_option_notes', 'kind', 'SELECT')
  and not has_table_privilege('authenticated', 'valtrim.plan_option_notes', 'INSERT')
  and not has_table_privilege('authenticated', 'valtrim.plan_option_notes', 'UPDATE')
  and not has_table_privilege('authenticated', 'valtrim.plan_option_notes', 'DELETE')
  and not has_table_privilege('anon', 'valtrim.plan_option_notes', 'SELECT')
);

-- Adding ----------------------------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'an ADMIN adds a note to the Plans and another to the Options',
  (select pg_temp.run_as(admin_id, format('select valtrim.add_plan_option_note(%s, %L, %L)::text', job_id, 'PLANS', '  Plan 1204 changed in the last revision  ')) like 'ok:%' from qt_ctx)
  and (select pg_temp.run_as(admin_id, format('select valtrim.add_plan_option_note(%s, %L, %L)::text', job_id, 'OPTIONS', 'Price pending from the vendor')) like 'ok:%' from qt_ctx)
);

select pg_temp.check_that(
  'each note keeps its thread, its trimmed text, its author with the name, and the moment',
  (select count(*) = 1 and bool_and(note.body = 'Plan 1204 changed in the last revision'
      and note.created_by = ctx.admin_id
      and note.author_name = (select name from valtrim.app_users where id = ctx.admin_id)
      and note.created_at > now() - interval '1 minute')
   from valtrim.plan_option_notes note, qt_ctx ctx
   where note.job_id = ctx.job_id and note.kind = 'PLANS')
  and (select count(*) = 1 from valtrim.plan_option_notes note, qt_ctx ctx
       where note.job_id = ctx.job_id and note.kind = 'OPTIONS' and note.body = 'Price pending from the vendor')
);

select pg_temp.check_that(
  'an empty note, a long note and an unknown thread are refused',
  (select pg_temp.run_as(admin_id, format('select valtrim.add_plan_option_note(%s, %L, %L)::text', job_id, 'PLANS', '   ')) like 'err:23514:%' from qt_ctx)
  and (select pg_temp.run_as(admin_id, format('select valtrim.add_plan_option_note(%s, %L, %L)::text', job_id, 'PLANS', repeat('x', 1001))) like 'err:23514:%' from qt_ctx)
  and (select pg_temp.run_as(admin_id, format('select valtrim.add_plan_option_note(%s, %L, %L)::text', job_id, 'LOTS', 'x')) like 'err:23514:%' from qt_ctx)
  and (select pg_temp.run_as(admin_id, format('select valtrim.add_plan_option_note(%s, null, %L)::text', job_id, 'x')) like 'err:23514:%' from qt_ctx)
);

select pg_temp.check_that(
  'a Job that does not exist is refused',
  (select pg_temp.run_as(admin_id, format('select valtrim.add_plan_option_note(%s, %L, %L)::text', -1, 'PLANS', 'x')) like 'err:P0002:%' from qt_ctx)
);

select pg_temp.check_that(
  'a role that does not keep Plans and Options cannot add a note',
  (select other_id is null
     or pg_temp.run_as(other_id, format('select valtrim.add_plan_option_note(%s, %L, %L)::text', job_id, 'PLANS', 'x')) like 'err:42501:%'
   from qt_ctx),
  (select other_role from qt_ctx)
);

-- Reading -------------------------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'every active user reads the notes',
  (select other_id is null
     or pg_temp.run_as(other_id, format('select count(*)::text from valtrim.plan_option_notes where job_id = %s', job_id)) = 'ok:2'
   from qt_ctx),
  (select other_role from qt_ctx)
);

select pg_temp.check_that(
  'the notes cannot be edited or deleted through the API',
  (select pg_temp.run_as(admin_id, 'update valtrim.plan_option_notes set body = ''x''') like 'err:42501:%' from qt_ctx)
  and (select pg_temp.run_as(admin_id, 'delete from valtrim.plan_option_notes') like 'err:42501:%' from qt_ctx)
);

select step, name, ok, detail from qt_results order by step;

rollback;
