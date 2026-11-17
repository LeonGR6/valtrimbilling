-- A Change Order without a title, against the real database, inside a transaction that is rolled back. Run it
-- after the migration; every row of the last result must have ok = true.
-- It makes one Draft of its own (with a fixed number) and, to try the creating function, a few more that are
-- rolled back with the rest. Creating takes numbers of the sequence and a sequence is not rolled back, so the
-- script puts it back as it found it before it ends.
-- Each action is a statement of its own and the check is the next one: a statement does not see what a
-- function it calls writes while it runs.

begin;

create temporary table ti_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table ti_ctx (
  admin_id uuid,
  reader_id uuid,
  job_id bigint,
  builder_id bigint,
  lot_id bigint,
  co_id bigint,
  seq_last bigint,
  seq_called boolean,
  seq_mid bigint
) on commit drop;

create temporary table ti_outcomes (
  label text primary key,
  outcome text
) on commit drop;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into ti_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
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
declare
  v_result text;
begin
  execute p_sql into v_result;
  return 'ok:' || coalesce(v_result, '');
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end;
$$;

-- The same for a statement that changes rows and returns nothing.
create function pg_temp.run_dml(p_sql text)
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

-- The id a statement returned ('ok:12' -> 12), or null when it failed.
create function pg_temp.id_of(p_outcome text)
returns bigint
language sql
as $$
  select nullif(regexp_replace(p_outcome, '^ok:', ''), '')::bigint
  where p_outcome like 'ok:%';
$$;

-- What is there before the checks: who does them, where, and the sequence.
insert into ti_ctx (admin_id, reader_id, job_id, builder_id, lot_id, seq_last, seq_called)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at limit 1),
  lot.job_id,
  job.builder_id,
  lot.id,
  (select last_value from valtrim.change_order_number_seq),
  (select is_called from valtrim.change_order_number_seq)
from valtrim.lots lot
join valtrim.jobs job on job.id = lot.job_id and job.is_active
join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
order by lot.id
limit 1;

insert into valtrim.change_orders (change_order_number, title, builder_id, job_id, requested_by, status)
select 'CO-TEST-90', 'Has a title', builder_id, job_id, 'Validation', 'DRAFT'
from ti_ctx;

update ti_ctx set co_id = (select id from valtrim.change_orders where change_order_number = 'CO-TEST-90');

select pg_temp.check_that('the validation has an Admin, a Job with a Lot and an Extra / CO to work with',
  (select admin_id is not null and reader_id is not null and job_id is not null and lot_id is not null
          and co_id is not null from ti_ctx));

-- The column -----------------------------------------------------------------------------------------------

select pg_temp.check_that('title is still a column of up to 150 characters, and it can be empty now',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'valtrim' and table_name = 'change_orders' and column_name = 'title'
      and data_type = 'character varying' and character_maximum_length = 150 and is_nullable = 'YES'
  )
);

insert into ti_outcomes values
  ('table null', pg_temp.run_dml(format(
    $q$update valtrim.change_orders set title = null where id = %s$q$, (select co_id from ti_ctx)))),
  ('table blank', pg_temp.run_dml(format(
    $q$update valtrim.change_orders set title = '   ' where id = %s$q$, (select co_id from ti_ctx))));

select pg_temp.check_that('the table accepts no title but refuses a title of only spaces',
  (select outcome from ti_outcomes where label = 'table null') = 'ok:'
  and (select outcome from ti_outcomes where label = 'table blank') like 'err:23514:%',
  (select string_agg(label || '=' || outcome, '; ') from ti_outcomes where label like 'table%')
);

-- The header check ---------------------------------------------------------------------------------------------

insert into ti_outcomes values
  ('header null', pg_temp.run_sql(format(
    $q$select private.check_change_order_header(%s, null, null, 'Carlos', null, null, null)::text$q$, (select job_id from ti_ctx)))),
  ('header 150', pg_temp.run_sql(format(
    $q$select private.check_change_order_header(%s, repeat('t', 150), null, 'Carlos', null, null, null)::text$q$, (select job_id from ti_ctx)))),
  ('header 151', pg_temp.run_sql(format(
    $q$select private.check_change_order_header(%s, repeat('t', 151), null, 'Carlos', null, null, null)::text$q$, (select job_id from ti_ctx)))),
  ('header no requester', pg_temp.run_sql(format(
    $q$select private.check_change_order_header(%s, null, null, '  ', null, null, null)::text$q$, (select job_id from ti_ctx))));

select pg_temp.check_that('no title and a title of 150 characters pass the header check',
  (select outcome from ti_outcomes where label = 'header null') = 'ok:' || (select builder_id from ti_ctx)::text
  and (select outcome from ti_outcomes where label = 'header 150') = 'ok:' || (select builder_id from ti_ctx)::text,
  (select string_agg(label || '=' || outcome, '; ') from ti_outcomes where label in ('header null', 'header 150'))
);

select pg_temp.check_that('a title of 151 characters is refused, and who requested it is still needed',
  (select outcome from ti_outcomes where label = 'header 151')
    = 'err:23514:The title must contain 150 characters or fewer'
  and (select outcome from ti_outcomes where label = 'header no requester')
    = 'err:23514:Write who requested it, up to 100 characters'
);

-- Creating -------------------------------------------------------------------------------------------------

create temporary table ti_created (
  label text primary key,
  id bigint
) on commit drop;

insert into ti_created
select 'null', pg_temp.id_of(pg_temp.run_as(
  (select admin_id from ti_ctx),
  format(
    $q$select valtrim.create_change_order(%s, null, 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb,
      p_po_co_number => '1277447-000')::text$q$,
    (select job_id from ti_ctx), (select lot_id from ti_ctx))
));

insert into ti_created
select 'blank', pg_temp.id_of(pg_temp.run_as(
  (select admin_id from ti_ctx),
  format(
    $q$select valtrim.create_change_order(%s, '   ', 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
    (select job_id from ti_ctx), (select lot_id from ti_ctx))
));

insert into ti_created
select 'titled', pg_temp.id_of(pg_temp.run_as(
  (select admin_id from ti_ctx),
  format(
    $q$select valtrim.create_change_order(%s, ' Attic ladder ', 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
    (select job_id from ti_ctx), (select lot_id from ti_ctx))
));

select pg_temp.check_that('an Extra / CO is created with no title, and keeps its PO / CO #',
  (select id is not null from ti_created where label = 'null')
  and (select title is null and po_co_number = '1277447-000'
       from valtrim.change_orders where id = (select id from ti_created where label = 'null'))
);

select pg_temp.check_that('a title of only spaces is stored as no title',
  (select id is not null from ti_created where label = 'blank')
  and (select title is null from valtrim.change_orders where id = (select id from ti_created where label = 'blank'))
);

select pg_temp.check_that('a title that is given is still trimmed and stored',
  (select title from valtrim.change_orders where id = (select id from ti_created where label = 'titled'))
    = 'Attic ladder'
);

select pg_temp.check_that('the internal numbers are still the Extra / CO number',
  not exists (
    select 1 from valtrim.change_orders
    where id in (select id from ti_created)
      and internal_number is distinct from change_order_number
  )
);

update ti_ctx set seq_mid = (select last_value from valtrim.change_order_number_seq);

insert into ti_outcomes
select 'create too long', pg_temp.run_as(
  (select admin_id from ti_ctx),
  format(
    $q$select valtrim.create_change_order(%s, repeat('t', 151), 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
    (select job_id from ti_ctx), (select lot_id from ti_ctx))
);

select pg_temp.check_that('a title that is too long refuses the Extra / CO and uses no number',
  (select outcome from ti_outcomes where label = 'create too long')
    = 'err:23514:The title must contain 150 characters or fewer'
  and (select last_value from valtrim.change_order_number_seq) = (select seq_mid from ti_ctx)
);

select pg_temp.check_that('someone who cannot create Extras / COs still cannot',
  pg_temp.run_as(
    (select reader_id from ti_ctx),
    format(
      $q$select valtrim.create_change_order(%s, null, 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
      (select job_id from ti_ctx), (select lot_id from ti_ctx))
  ) like 'err:42501:%'
);

-- Editing --------------------------------------------------------------------------------------------------

update valtrim.change_orders set title = 'Old title', po_co_number = 'KEEP-ME' where id = (select co_id from ti_ctx);

insert into ti_outcomes
select 'edit null', pg_temp.run_as(
  (select admin_id from ti_ctx),
  format(
    $q$select valtrim.update_change_order(%s, %s, null, 'Validation',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb,
      p_po_co_number => 'KEEP-ME')::text$q$,
    (select co_id from ti_ctx), (select job_id from ti_ctx), (select lot_id from ti_ctx))
);

select pg_temp.check_that('editing without a title clears the old one and keeps the PO / CO #',
  (select outcome from ti_outcomes where label = 'edit null') = 'ok:'
  and (select title is null and po_co_number = 'KEEP-ME'
       from valtrim.change_orders where id = (select co_id from ti_ctx)),
  (select outcome from ti_outcomes where label = 'edit null')
);

insert into ti_outcomes
select 'edit titled', pg_temp.run_as(
  (select admin_id from ti_ctx),
  format(
    $q$select valtrim.update_change_order(%s, %s, ' New title ', 'Validation',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
    (select co_id from ti_ctx), (select job_id from ti_ctx), (select lot_id from ti_ctx))
);

select pg_temp.check_that('editing with a title still saves it, trimmed',
  (select outcome from ti_outcomes where label = 'edit titled') = 'ok:'
  and (select title from valtrim.change_orders where id = (select co_id from ti_ctx)) = 'New title',
  (select outcome from ti_outcomes where label = 'edit titled')
);

insert into ti_outcomes
select 'edit too long', pg_temp.run_as(
  (select admin_id from ti_ctx),
  format(
    $q$select valtrim.update_change_order(%s, %s, repeat('t', 151), 'Validation',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
    (select co_id from ti_ctx), (select job_id from ti_ctx), (select lot_id from ti_ctx))
);

select pg_temp.check_that('a title that is too long is refused when editing and the old one stays',
  (select outcome from ti_outcomes where label = 'edit too long')
    = 'err:23514:The title must contain 150 characters or fewer'
  and (select title from valtrim.change_orders where id = (select co_id from ti_ctx)) = 'New title'
);

-- Who can call what: the same as before --------------------------------------------------------------------

select pg_temp.check_that('there is still one create and one update function in each schema, each with the PO / CO # argument',
  (select count(*) from pg_proc
   where proname in ('create_change_order', 'update_change_order')
     and pronamespace in ('valtrim'::regnamespace, 'private'::regnamespace)
     and pg_get_function_arguments(oid) like '%p_po_co_number text%') = 4
  and (select count(*) from pg_proc
       where proname in ('create_change_order', 'update_change_order')) = 4
);

select pg_temp.check_that('signed-in users call the writers; anonymous ones do not; the header check is nobody''s',
  has_function_privilege('authenticated',
    'valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text)',
    'execute')
  and has_function_privilege('authenticated',
    'valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text)',
    'execute')
  and not has_function_privilege('anon',
    'valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text)',
    'execute')
  and not has_function_privilege('anon',
    'valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text)',
    'execute')
  and not has_function_privilege('authenticated',
    'private.check_change_order_header(bigint, text, text, text, date, date, jsonb)', 'execute')
);

-- Put the sequence back as it was found: the numbers the checks above took are not used by anyone.
select setval('valtrim.change_order_number_seq', seq_last, seq_called) from ti_ctx;

select pg_temp.check_that('the number sequence is as it was before the checks',
  (select last_value from valtrim.change_order_number_seq) = (select seq_last from ti_ctx)
  and (select is_called from valtrim.change_order_number_seq) = (select seq_called from ti_ctx)
);

select step, name, ok, detail from ti_results order by step;

rollback;
