begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

-- The functions of valtrim and private whose has_app_role call names DRAW_INVOICE.
create function pg_temp.functions_naming_the_role()
returns text
language sql
as $$
  select string_agg(distinct procedure.proname, ' ' order by procedure.proname)
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('valtrim', 'private')
    and procedure.prosrc ~ 'has_app_role\s*\([^)]*DRAW_INVOICE'
$$;

select is(
  (select array_agg(enumlabel::text order by enumsortorder)
   from pg_enum
   where enumtypid = 'valtrim.app_role'::regtype),
  array['ADMIN', 'ACCOUNTING', 'DRAW_INVOICE', 'PROJECT_MANAGEMENT', 'SCHEDULING', 'CUSTOMER_SERVICE', 'FIELD', 'READ_ONLY'],
  'Draw & Invoice is a role of its own, next to Accounting'
);

select is(
  pg_temp.functions_naming_the_role(),
  (select string_agg(f.name, ' ' order by f.name)
   from (values
     ('add_draw_package_note'),
     ('add_job_note'),
     ('confirm_payment_schedule_template'),
     ('confirm_release_template'),
     ('correct_draw_invoice_package'),
     ('create_draw_invoice_package'),
     ('create_draw_invoice_package_with_hardware_events'),
     ('create_options_package'),
     ('create_price_adjustment_package'),
     ('create_retention_release_package'),
     ('delete_job_document'),
     ('delete_package_payment_schedule'),
     ('delete_package_release'),
     ('mark_package_submitted_internal'),
     ('prepare_draw_package'),
     ('register_job_document'),
     ('register_package_payment_schedule'),
     ('register_package_release'),
     ('reject_package_hardware_line_change'),
     ('reject_package_line_change'),
     ('set_draw_package_workflow_status'),
     ('set_quickbooks_active_environment')
   ) as f(name)),
  'The role works in Packages, their documents and notes and chooses the QuickBooks mode, and in nothing else (not Builder Setup, Jobs, Plans, Prices, the Calendar or Sequence Sheets)'
);

select is(
  (select string_agg(policy.tablename || '.' || policy.policyname, ' ' order by policy.tablename, policy.policyname)
   from pg_policies policy
   where coalesce(policy.qual, '') || coalesce(policy.with_check, '') like '%DRAW_INVOICE%'),
  'job_notes.job_notes_select'
    || ' objects.job_documents_objects_delete'
    || ' objects.job_documents_objects_insert'
    || ' objects.package_documents_objects_delete'
    || ' objects.package_documents_objects_insert'
    || ' package_price_differences.package_price_differences_select',
  'Policies name the role only to read Job notes and price differences and to keep the documents of Jobs and Packages'
);

select is(
  (select string_agg(f.name, ' ' order by f.name)
   from (values
     ('save_builder_billing_setup'),
     ('deactivate_builder_billing_setup'),
     ('set_plan_price'),
     ('set_option_price'),
     ('save_production_activity'),
     ('save_sequence_sheet_phase'),
     ('change_job_billing_setup')
   ) as f(name)
   where exists (
     select 1
     from pg_proc procedure
     join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname in ('valtrim', 'private')
       and procedure.proname = f.name
       and procedure.prosrc like '%DRAW_INVOICE%'
   )),
  null::text,
  'Builder Setup, prices, the Calendar and the Sequence Sheets are closed to the role'
);

select is(
  array[
    obj_description('valtrim.add_job_note(bigint,text)'::regprocedure, 'pg_proc') like '%ADMIN, ACCOUNTING and DRAW_INVOICE only.',
    obj_description('valtrim.save_builder_billing_setup(bigint,jsonb,jsonb,jsonb)'::regprocedure, 'pg_proc') like '%ADMIN and ACCOUNTING only.'
  ],
  array[true, true],
  'The comments of the functions name the roles that can call them'
);

select is(
  (select array_agg(token[1] order by token[1])
   from regexp_matches(
     (regexp_match(
       (select prosrc from pg_proc where oid = 'private.set_quickbooks_active_environment(text)'::regprocedure),
       'has_app_role\s*\(([^()]*)\)'
     ))[1],
     '''([A-Z_]+)''',
     'g'
   ) as token),
  array['ADMIN', 'DRAW_INVOICE'],
  'ADMIN and DRAW_INVOICE choose the QuickBooks mode; ACCOUNTING does not'
);

select ok(
  (select obj_description(policy.oid, 'pg_policy') = 'ADMIN, ACCOUNTING and DRAW_INVOICE can read Job notes.'
   from pg_policy policy
   where policy.polrelid = 'valtrim.job_notes'::regclass
     and policy.polname = 'job_notes_select'),
  'The comment of the Job notes policy names the role'
);

select * from finish();

rollback;
