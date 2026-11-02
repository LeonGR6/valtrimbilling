begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- The roles named by the has_app_role call of a function or a policy, as 'ACCOUNTING,ADMIN'.
create function pg_temp.function_roles(p_schema text, p_name text)
returns text
language sql
as $$
  select (
    select string_agg(token[1], ',' order by token[1])
    from regexp_matches(
      (regexp_match(procedure.prosrc, 'has_app_role\s*\(([^()]*)\)'))[1],
      '''([A-Z_]+)''',
      'g'
    ) as token
  )
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = p_schema
    and procedure.proname = p_name
    and procedure.prosrc like '%has_app_role%'
$$;

create function pg_temp.policy_roles(p_schema text, p_table text, p_policy text)
returns text
language sql
as $$
  select (
    select string_agg(token[1], ',' order by token[1])
    from regexp_matches(
      (regexp_match(coalesce(policy.qual, policy.with_check), 'has_app_role\s*\(([^()]*)\)'))[1],
      '''([A-Z_]+)''',
      'g'
    ) as token
  )
  from pg_policies policy
  where policy.schemaname = p_schema
    and policy.tablename = p_table
    and policy.policyname = p_policy
$$;

select is(
  (select array_agg(enumlabel::text order by enumsortorder)
   from pg_enum
   where enumtypid = 'valtrim.app_role'::regtype),
  array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT', 'SCHEDULING', 'CUSTOMER_SERVICE', 'FIELD', 'READ_ONLY'],
  'Customer Service is a role of its own'
);

select is(
  (select string_agg(f.name, ' ' order by f.name)
   from (values
     ('private', 'create_draw_invoice_package'),
     ('private', 'create_draw_invoice_package_with_hardware_events'),
     ('private', 'create_options_package'),
     ('private', 'create_price_adjustment_package'),
     ('private', 'create_retention_release_package'),
     ('private', 'correct_draw_invoice_package'),
     ('private', 'set_draw_package_workflow_status'),
     ('private', 'add_draw_package_note'),
     ('private', 'add_job_note'),
     ('private', 'mark_package_submitted_internal'),
     ('private', 'register_job_document'),
     ('private', 'delete_job_document'),
     ('private', 'register_package_release'),
     ('private', 'delete_package_release'),
     ('private', 'register_package_payment_schedule'),
     ('private', 'delete_package_payment_schedule'),
     ('private', 'confirm_release_template'),
     ('private', 'confirm_payment_schedule_template'),
     ('valtrim', 'save_builder_billing_setup'),
     ('valtrim', 'deactivate_builder_billing_setup')
   ) as f(schema_name, name)
   where pg_temp.function_roles(f.schema_name, f.name) is distinct from 'ACCOUNTING,ADMIN'),
  null::text,
  'Packages, their documents and notes, and the Builder billing setup belong to ADMIN and ACCOUNTING'
);

select is(
  (select string_agg(f.name, ' ' order by f.name)
   from (values
     ('valtrim', 'prepare_draw_package'),
     ('valtrim', 'reject_package_line_change'),
     ('valtrim', 'reject_package_hardware_line_change')
   ) as f(schema_name, name)
   where pg_temp.function_roles(f.schema_name, f.name) is distinct from 'ACCOUNTING,ADMIN,PROJECT_MANAGEMENT'),
  null::text,
  'The Package line guards also let PROJECT_MANAGEMENT through, because its price changes recalculate draft Packages'
);

select is(
  (select string_agg(f.name, ' ' order by f.name)
   from (values
     ('private', 'save_production_activity'),
     ('private', 'cancel_production_activity'),
     ('private', 'save_builder_date_configuration'),
     ('private', 'record_builder_follow_up_status'),
     ('private', 'refresh_builder_follow_up_checkpoints'),
     ('private', 'refresh_builder_follow_up_escalations'),
     ('valtrim', 'resolve_builder_follow_up_reschedule_request'),
     ('valtrim', 'save_sequence_sheet_phase'),
     ('valtrim', 'deactivate_sequence_sheet_phase')
   ) as f(schema_name, name)
   where pg_temp.function_roles(f.schema_name, f.name) is distinct from 'ADMIN,SCHEDULING'),
  null::text,
  'The Calendar and the Sequence Sheets belong to ADMIN and SCHEDULING'
);

select is(
  (select string_agg(f.name, ' ' order by f.name)
   from (values
     ('private', 'create_company_contact_internal'),
     ('private', 'create_supervisor_internal'),
     ('private', 'set_company_contact_roles_internal'),
     ('private', 'save_builder_follow_up_escalation_settings'),
     ('private', 'set_quickbooks_active_environment')
   ) as f(schema_name, name)
   where pg_temp.function_roles(f.schema_name, f.name) is distinct from 'ADMIN'),
  null::text,
  'People, the escalation settings and the QuickBooks environment are for ADMIN only'
);

select is(
  (select string_agg(f.name, ' ' order by f.name)
   from (values
     ('valtrim', 'apply_phase_price_changes'),
     ('valtrim', 'apply_plan_option_changes'),
     ('valtrim', 'change_job_billing_setup'),
     ('valtrim', 'deactivate_job_plan'),
     ('valtrim', 'deactivate_plan_option'),
     ('valtrim', 'import_purchase_order_options'),
     ('valtrim', 'preview_job_billing_setup_change'),
     ('valtrim', 'preview_phase_price_changes'),
     ('valtrim', 'reorder_job_plans'),
     ('valtrim', 'set_job_prices'),
     ('valtrim', 'set_option_price'),
     ('valtrim', 'set_plan_price'),
     ('valtrim', 'use_purchase_order_price')
   ) as f(schema_name, name)
   where pg_temp.function_roles(f.schema_name, f.name) is distinct from 'ADMIN,PROJECT_MANAGEMENT'),
  null::text,
  'Plans, Options, prices and Purchase Orders stay with ADMIN and PROJECT_MANAGEMENT'
);

select is(
  (select string_agg(p.table_name || '.' || p.policy_name, ' ' order by p.table_name, p.policy_name)
   from (values
     ('valtrim', 'builder_contact_types', 'builder_contact_types_insert'),
     ('valtrim', 'builder_contacts', 'builder_contacts_insert'),
     ('valtrim', 'builder_contacts', 'builder_contacts_update'),
     ('valtrim', 'people', 'company_people_update')
   ) as p(schema_name, table_name, policy_name)
   where pg_temp.policy_roles(p.schema_name, p.table_name, p.policy_name) is distinct from 'ADMIN'),
  null::text,
  'Builder Contacts and People are written by ADMIN only'
);

select is(
  (select string_agg(p.table_name || '.' || p.policy_name, ' ' order by p.table_name, p.policy_name)
   from (values
     ('valtrim', 'job_notes', 'job_notes_select'),
     ('storage', 'objects', 'job_documents_objects_insert'),
     ('storage', 'objects', 'package_documents_objects_insert')
   ) as p(schema_name, table_name, policy_name)
   where pg_temp.policy_roles(p.schema_name, p.table_name, p.policy_name) is distinct from 'ACCOUNTING,ADMIN'),
  null::text,
  'Job notes are read, and Job and Package documents uploaded, by ADMIN and ACCOUNTING'
);

select is(
  (select string_agg(p.table_name || '.' || p.policy_name, ' ' order by p.table_name, p.policy_name)
   from (values
     ('valtrim', 'builders', 'builders_insert'),
     ('valtrim', 'builders', 'builders_update'),
     ('valtrim', 'jobs', 'jobs_insert'),
     ('valtrim', 'jobs', 'jobs_update'),
     ('valtrim', 'plans', 'plans_insert'),
     ('valtrim', 'plans', 'plans_update'),
     ('valtrim', 'plan_options', 'plan_options_insert'),
     ('valtrim', 'plan_options', 'plan_options_update')
   ) as p(schema_name, table_name, policy_name)
   where pg_temp.policy_roles(p.schema_name, p.table_name, p.policy_name) is distinct from 'ADMIN,PROJECT_MANAGEMENT'),
  null::text,
  'Builders (created from the Jobs screen), Jobs, Plans and Options stay with ADMIN and PROJECT_MANAGEMENT'
);

select is(
  (select string_agg(p.policy_name, ' ' order by p.policy_name)
   from (values
     ('storage', 'objects', 'job_documents_objects_delete'),
     ('storage', 'objects', 'package_documents_objects_delete'),
     ('valtrim', 'package_price_differences', 'package_price_differences_select')
   ) as p(schema_name, table_name, policy_name)
   where pg_temp.policy_roles(p.schema_name, p.table_name, p.policy_name) is distinct from 'ACCOUNTING,ADMIN,PROJECT_MANAGEMENT'),
  null::text,
  'PROJECT_MANAGEMENT still clears the PDFs of a draft Package it recalculates and sees the price differences'
);

select is(
  (select string_agg(f.name, ' ' order by f.name)
   from (values
     ('create_draw_invoice_package'),
     ('create_options_package'),
     ('create_price_adjustment_package'),
     ('create_retention_release_package'),
     ('save_sequence_sheet_phase'),
     ('save_production_activity')
   ) as f(name)
   where exists (
     select 1
     from pg_proc procedure
     join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname in ('valtrim', 'private')
       and procedure.proname = f.name
       and procedure.prosrc ~ 'has_app_role\s*\([^)]*PROJECT_MANAGEMENT'
   )),
  null::text,
  'PROJECT_MANAGEMENT can no longer create Packages, edit Sequence Sheets or schedule the Calendar'
);

select is(
  array[
    obj_description('valtrim.cancel_production_activity(bigint)'::regprocedure, 'pg_proc') like '%ADMIN and SCHEDULING only.',
    obj_description('valtrim.add_job_note(bigint,text)'::regprocedure, 'pg_proc') like '%ADMIN and ACCOUNTING only.',
    obj_description('valtrim.save_builder_billing_setup(bigint,jsonb,jsonb,jsonb)'::regprocedure, 'pg_proc') like '%ADMIN and ACCOUNTING only.'
  ],
  array[true, true, true],
  'The comments of the functions name the roles that can call them'
);

select * from finish();

rollback;
