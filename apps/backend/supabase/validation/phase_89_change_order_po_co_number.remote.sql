-- The PO / CO # of an Extra / Change Order, against the real database, inside a transaction that is rolled
-- back. Run it after the migration; every row of the last result must have ok = true.
-- It makes one Draft of its own (with a fixed number) and, to try the creating function, a few more that
-- are rolled back with the rest. Creating takes numbers of the sequence and a sequence is not rolled back,
-- so the script puts it back as it found it before it ends.

begin;

create temporary table po_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table po_ctx (
  admin_id uuid,
  reader_id uuid,
  job_id bigint,
  builder_id bigint,
  lot_id bigint,
  co_id bigint,
  seq_last bigint,
  seq_called boolean,
  orders_before bigint,
  seq_mid bigint
) on commit drop;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into po_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
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

-- The id a statement returned ('ok:12' -> 12), or null when it failed.
create function pg_temp.id_of(p_outcome text)
returns bigint
language sql
as $$
  select nullif(regexp_replace(p_outcome, '^ok:', ''), '')::bigint
  where p_outcome like 'ok:%';
$$;

insert into po_ctx (admin_id, reader_id, job_id, builder_id, lot_id, seq_last, seq_called, orders_before)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at limit 1),
  lot.job_id,
  job.builder_id,
  lot.id,
  (select last_value from valtrim.change_order_number_seq),
  (select is_called from valtrim.change_order_number_seq),
  (select count(*) from valtrim.change_orders)
from valtrim.lots lot
join valtrim.jobs job on job.id = lot.job_id and job.is_active
join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
order by lot.id
limit 1;

insert into valtrim.change_orders (change_order_number, title, builder_id, job_id, requested_by, status)
select 'CO-TEST-89', 'PO / CO number', builder_id, job_id, 'Validation', 'DRAFT'
from po_ctx;

update po_ctx set co_id = (select id from valtrim.change_orders where change_order_number = 'CO-TEST-89');

select pg_temp.check_that('the validation has an Admin, a Job with a Lot and an Extra / CO to work with',
  (select admin_id is not null and reader_id is not null and job_id is not null and lot_id is not null
          and co_id is not null from po_ctx));

-- The column ---------------------------------------------------------------------------------------------

select pg_temp.check_that('po_co_number is a column of up to 60 characters that can be empty',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'valtrim' and table_name = 'change_orders' and column_name = 'po_co_number'
      and data_type = 'character varying' and character_maximum_length = 60 and is_nullable = 'YES'
  )
);

select pg_temp.check_that('an Extra / CO made before has no PO / CO # (the Draft above did not get one)',
  (select po_co_number is null from valtrim.change_orders where id = (select co_id from po_ctx))
);

select pg_temp.check_that('a PO / CO # of only spaces is refused by the table',
  pg_temp.run_sql(format(
    $q$update valtrim.change_orders set po_co_number = '   ' where id = %s$q$,
    (select co_id from po_ctx))) like 'err:23514:%'
);

-- Cleaning the number ------------------------------------------------------------------------------------

select pg_temp.check_that('every kind of space becomes one plain space and the ends are trimmed',
  private.clean_po_co_number(E' CO#  4400102/247\t\n ') = 'CO# 4400102/247'
);

select pg_temp.check_that('nothing, spaces or non-breaking spaces alone mean no number',
  private.clean_po_co_number(null) is null
  and private.clean_po_co_number('') is null
  and private.clean_po_co_number(E'     ') is null
);

select pg_temp.check_that('leading zeros, dashes, slashes and letters are part of the number',
  private.clean_po_co_number('0001277447-000') = '0001277447-000'
  and private.clean_po_co_number('M2068526708') = 'M2068526708'
  and private.clean_po_co_number('4010-C-003232') = '4010-C-003232'
);

select pg_temp.check_that('60 characters are accepted and 61 are refused',
  pg_temp.run_sql($q$select private.clean_po_co_number(repeat('1', 60))$q$) like 'ok:%'
  and pg_temp.run_sql($q$select private.clean_po_co_number(repeat('1', 61))$q$) like 'err:23514:%'
);

select pg_temp.check_that('the cleaning function is not callable from the browser',
  not has_function_privilege('authenticated', 'private.clean_po_co_number(text)', 'execute')
  and not has_function_privilege('anon', 'private.clean_po_co_number(text)', 'execute')
);

-- Creating -------------------------------------------------------------------------------------------------

create temporary table po_created (
  label text primary key,
  id bigint
) on commit drop;

insert into po_created
select 'with', pg_temp.id_of(pg_temp.run_as(
  (select admin_id from po_ctx),
  format(
    $q$select valtrim.create_change_order(%s, 'With PO', 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb,
      p_po_co_number => E' CO #37 ')::text$q$,
    (select job_id from po_ctx), (select lot_id from po_ctx))
));

insert into po_created
select 'without', pg_temp.id_of(pg_temp.run_as(
  (select admin_id from po_ctx),
  format(
    $q$select valtrim.create_change_order(%s, 'Without PO', 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
    (select job_id from po_ctx), (select lot_id from po_ctx))
));

select pg_temp.check_that('an Extra / CO is created with its PO / CO #, cleaned',
  (select po_co_number from valtrim.change_orders where id = (select id from po_created where label = 'with'))
    = 'CO #37'
);

select pg_temp.check_that('creating without the argument still works and leaves the PO / CO # empty',
  (select id is not null from po_created where label = 'without')
  and (select po_co_number is null from valtrim.change_orders where id = (select id from po_created where label = 'without'))
);

select pg_temp.check_that('the internal numbers are still the Extra / CO number',
  not exists (
    select 1 from valtrim.change_orders
    where id in (select id from po_created)
      and (internal_number is distinct from change_order_number)
  )
);

update po_ctx set seq_mid = (select last_value from valtrim.change_order_number_seq);

create temporary table po_refused on commit drop as
select pg_temp.run_as(
  (select admin_id from po_ctx),
  format(
    $q$select valtrim.create_change_order(%s, 'Too long', 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb,
      p_po_co_number => repeat('9', 61))::text$q$,
    (select job_id from po_ctx), (select lot_id from po_ctx))
) as outcome;

select pg_temp.check_that('a PO / CO # that is too long refuses the Extra / CO and uses no number',
  (select outcome from po_refused) = 'err:23514:The PO / CO # must contain 60 characters or fewer'
  and (select last_value from valtrim.change_order_number_seq) = (select seq_mid from po_ctx)
  and (select count(*) from valtrim.change_orders where title = 'Too long') = 0
);

select pg_temp.check_that('someone who cannot create Extras / COs still cannot, with or without a PO / CO #',
  pg_temp.run_as(
    (select reader_id from po_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'No', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb,
        p_po_co_number => '123')::text$q$,
      (select job_id from po_ctx), (select lot_id from po_ctx))
  ) like 'err:42501:%'
);

-- Editing --------------------------------------------------------------------------------------------------
-- Each change is made in a statement of its own and looked at in the next one: a statement does not see
-- what a function it calls writes while it runs.

create temporary table po_outcomes (
  label text primary key,
  outcome text
) on commit drop;

insert into po_outcomes
select 'edit with', pg_temp.run_as(
  (select admin_id from po_ctx),
  format(
    $q$select valtrim.update_change_order(%s, %s, 'PO / CO number', 'Validation',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb,
      p_po_co_number => E' 1277447-000 ')::text$q$,
    (select co_id from po_ctx), (select job_id from po_ctx), (select lot_id from po_ctx))
);

select pg_temp.check_that('editing saves the PO / CO #, cleaned',
  (select outcome from po_outcomes where label = 'edit with') = 'ok:'
  and (select po_co_number from valtrim.change_orders where id = (select co_id from po_ctx)) = '1277447-000',
  (select outcome from po_outcomes where label = 'edit with')
);

insert into po_outcomes
select 'edit without', pg_temp.run_as(
  (select admin_id from po_ctx),
  format(
    $q$select valtrim.update_change_order(%s, %s, 'PO / CO number', 'Validation',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
    (select co_id from po_ctx), (select job_id from po_ctx), (select lot_id from po_ctx))
);

select pg_temp.check_that('editing without a PO / CO # clears it',
  (select outcome from po_outcomes where label = 'edit without') = 'ok:'
  and (select po_co_number is null from valtrim.change_orders where id = (select co_id from po_ctx)),
  (select outcome from po_outcomes where label = 'edit without')
);

update valtrim.change_orders set po_co_number = 'KEEP-ME' where id = (select co_id from po_ctx);

insert into po_outcomes
select 'edit too long', pg_temp.run_as(
  (select admin_id from po_ctx),
  format(
    $q$select valtrim.update_change_order(%s, %s, 'PO / CO number', 'Validation',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb,
      p_po_co_number => repeat('9', 61))::text$q$,
    (select co_id from po_ctx), (select job_id from po_ctx), (select lot_id from po_ctx))
);

select pg_temp.check_that('a PO / CO # that is too long is refused when editing and the old one stays',
  (select outcome from po_outcomes where label = 'edit too long')
    = 'err:23514:The PO / CO # must contain 60 characters or fewer'
  and (select po_co_number from valtrim.change_orders where id = (select co_id from po_ctx)) = 'KEEP-ME',
  (select outcome from po_outcomes where label = 'edit too long')
);

-- The list -------------------------------------------------------------------------------------------------

select pg_temp.check_that('the overview gives the PO / CO # as its last column and keeps the others in place',
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'valtrim' and table_name = 'change_order_overview')
  = array['id', 'change_order_number', 'internal_number', 'title', 'status', 'builder_id', 'builder_name',
          'job_id', 'job_code', 'community', 'requested_by', 'request_date', 'needed_by_date', 'created_at',
          'updated_at', 'line_count', 'total_amount', 'po_co_number']
);

select pg_temp.check_that('a signed-in user reads the PO / CO # in the overview',
  pg_temp.run_as(
    (select admin_id from po_ctx),
    format($q$select po_co_number from valtrim.change_order_overview where id = %s$q$, (select co_id from po_ctx))
  ) = 'ok:KEEP-ME'
);

select pg_temp.check_that('the overview is still not readable by anonymous users',
  not has_table_privilege('anon', 'valtrim.change_order_overview', 'select')
  and has_table_privilege('authenticated', 'valtrim.change_order_overview', 'select')
);

-- Who can call what ----------------------------------------------------------------------------------------

select pg_temp.check_that('there is one create and one update function in each schema, with the PO / CO # argument',
  (select count(*) from pg_proc
   where proname in ('create_change_order', 'update_change_order')
     and pronamespace in ('valtrim'::regnamespace, 'private'::regnamespace)) = 4
  and (select count(*) from pg_proc
       where proname in ('create_change_order', 'update_change_order')
         and pronamespace in ('valtrim'::regnamespace, 'private'::regnamespace)
         and pg_get_function_arguments(oid) like '%p_po_co_number text%') = 4
);

select pg_temp.check_that('signed-in users call the writers; anonymous ones do not',
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
);

-- Put the sequence back as it was found: the numbers the checks above took are not used by anyone.
select setval('valtrim.change_order_number_seq', seq_last, seq_called) from po_ctx;

select pg_temp.check_that('the number sequence is as it was before the checks',
  (select last_value from valtrim.change_order_number_seq) = (select seq_last from po_ctx)
  and (select is_called from valtrim.change_order_number_seq) = (select seq_called from po_ctx)
);

select step, name, ok, detail from po_results order by step;

rollback;
