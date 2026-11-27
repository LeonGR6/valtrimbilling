begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  to_regprocedure(
    'valtrim.edit_draw_invoice_package(bigint,jsonb,text,date,date,text)'
  ) is null,
  'The former Edit Package RPC with billing period dates is removed'
);

select ok(
  to_regprocedure(
    'valtrim.edit_draw_invoice_package(bigint,jsonb,text,text)'
  ) is not null,
  'Edit Package accepts only Package, cells, reason and notes'
);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'valtrim'
      and procedure.proname = 'edit_draw_invoice_package'
  ),
  1,
  'PostgREST exposes one unambiguous Edit Package RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.edit_draw_invoice_package(bigint,jsonb,text,text)',
    'execute'
  ) and not has_function_privilege(
    'anon',
    'valtrim.edit_draw_invoice_package(bigint,jsonb,text,text)',
    'execute'
  ),
  'Only authenticated application users can call the public edit RPC'
);

select ok(
  to_regprocedure(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'
  ) is null,
  'The private correction implementation no longer accepts billing period dates'
);

select ok(
  to_regprocedure(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'
  ) is not null,
  'All correction wrappers target the date-free private implementation'
);

select ok(coalesce((
  select prosecdef
    and proconfig @> array['search_path=""']
  from pg_proc
  where oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
), false), 'The role-checked correction boundary remains secured');

select ok(coalesce((
  select prosrc not like '%p_period_start%'
    and prosrc not like '%p_period_end%'
    and prosrc not like '%Billing period end cannot precede%'
    and prosrc not like '%billing_period_start =%'
    and prosrc not like '%billing_period_end =%'
  from pg_proc
  where oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
), false), 'Package edits contain no billing period validation or update behavior');

select ok(coalesce((
  select prosrc like '%jsonb_build_object(''notes'', v_target.notes)%'
    and prosrc like '%jsonb_build_object(''notes'', v_notes)%'
    and prosrc not like '%''period_start''%'
    and prosrc not like '%''period_end''%'
  from pg_proc
  where oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
), false), 'Edit correction history records notes without billing period dates');

select ok(coalesce((
  select prosrc like '%private.correct_draw_invoice_package(%'
    and prosrc not like '%p_period_start%'
    and prosrc not like '%p_period_end%'
  from pg_proc
  where oid = 'valtrim.edit_draw_invoice_package(bigint,jsonb,text,text)'::regprocedure
), false), 'The public edit wrapper cannot forward billing period dates');

select * from finish();

rollback;
