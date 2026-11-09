begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_function(
  'valtrim', 'edit_invoiced_draw_package',
  array['uuid', 'bigint', 'jsonb', 'jsonb', 'jsonb', 'text', 'text', 'boolean', 'jsonb'],
  'The edit of an invoiced Package takes the free Options to put back as its last argument'
);

select ok(
  to_regprocedure('valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)') is null,
  'The eight-argument edit is gone, so a call can never reach an edit that ignores the Options to add'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)', 'execute')
  and not has_function_privilege('anon', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)', 'execute')
  and has_function_privilege('service_role', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)', 'execute'),
  'Only the Edge Function (service role) can edit an invoiced Package'
);

select ok(
  (select prosecdef from pg_proc where oid = 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)'::regprocedure)
  and (select proconfig::text like '%search_path=%' from pg_proc where oid = 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)'::regprocedure),
  'The edit runs as its owner with an empty search path'
);

select ok(
  (select pg_get_function_arguments('valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)'::regprocedure)
     like '%p_added_options jsonb DEFAULT ''[]''::jsonb')
  and (select prosrc like '%added_options%' and prosrc like '%private.regenerate_package_option_cell%'
       from pg_proc where oid = 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)'::regprocedure),
  'The Options to add default to none, are listed in the answer and the history, and ride on one cell generated again'
);

select ok(
  (select prosrc like '%already billed%' and prosrc like '%reached or passed the Options billing Draw%'
     and prosrc like '%cannot be released and added in the same edit%'
   from pg_proc where oid = 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)'::regprocedure),
  'A unit already billed, one whose Lot has not reached the Options billing Draw and one released in the same edit are refused'
);

select has_function(
  'private', 'regenerate_package_option_cell',
  array['bigint', 'bigint', 'bigint', 'smallint', 'jsonb'],
  'One cell can be generated again with its Options plus others'
);

select ok(
  not has_function_privilege('authenticated', 'private.regenerate_package_option_cell(bigint,bigint,bigint,smallint,jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.regenerate_package_option_cell(bigint,bigint,bigint,smallint,jsonb)', 'execute'),
  'Nobody but the edit can regenerate a cell'
);

select ok(
  (select count(*) = 0
   from pg_proc procedure
   join pg_namespace namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'valtrim'
     and procedure.proname = 'edit_invoiced_draw_package'
     and procedure.prosrc !~ 'DRAW_INVOICE'),
  'The edit still names the Draw & Invoice role next to Admin and Accounting'
);

select * from finish();

rollback;
