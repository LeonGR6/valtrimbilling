begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_table(
  'valtrim',
  'release_templates',
  'Release templates are persisted'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.release_templates'::regclass),
  'Release templates have RLS enabled'
);

select enum_has_labels(
  'valtrim',
  'release_type',
  array[
    'ConditionalWaiverAndReleaseOnProgressPayment',
    'ConditionalWaiverAndReleaseOnFinalPayment',
    'UnconditionalWaiverAndReleaseOnProgressPayment',
    'UnconditionalWaiverAndReleaseOnFinalPayment'
  ],
  'The Release type enum has the four statutory forms'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.release_templates', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.release_templates', 'update')
  and not has_table_privilege('authenticated', 'valtrim.release_templates', 'delete')
  and has_table_privilege('authenticated', 'valtrim.release_templates', 'select')
  and not has_table_privilege('anon', 'valtrim.release_templates', 'select'),
  'Browsers can only read Release templates and anonymous users cannot'
);

select ok(
  has_table_privilege('service_role', 'valtrim.release_templates', 'insert')
  and has_table_privilege('service_role', 'valtrim.release_templates', 'update'),
  'The analyze Edge Function can write analysis results as service_role'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'release_templates'
  $$,
  $$ values ('release_templates_select') $$,
  'Release templates expose only their active-user read policy'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.release_templates'::regclass
      and confrelid = 'valtrim.job_documents'::regclass
      and contype = 'f'
      and confdeltype = 'c'
  ),
  'Deleting a Job document deletes its Release template'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.release_templates'::regclass
      and contype = 'u'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'valtrim.release_templates'::regclass
          and attname = 'job_document_id'
      )]
  ),
  'A document has at most one Release template'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'valtrim'
      and tablename = 'release_templates'
      and indexname = 'release_templates_confirmed_job_type_key'
      and indexdef like 'CREATE UNIQUE INDEX%'
      and indexdef like '%(job_id, release_type)%'
      and indexdef like '%status = ''confirmed''%'
  ),
  'Only one confirmed template exists per Job and Release type'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.release_templates'::regclass
      and conname = 'release_templates_confirmed_check'
      and pg_get_constraintdef(oid) like '%mapping IS NOT NULL%'
      and pg_get_constraintdef(oid) like '%release_type IS NOT NULL%'
  ),
  'Confirmed templates always carry a type, a mapping and the confirming user'
);

select has_trigger(
  'valtrim',
  'release_templates',
  'release_templates_sync_document',
  'The Job is derived from the RELEASE document'
);

select has_trigger(
  'valtrim',
  'release_templates',
  'release_templates_set_updated_at',
  'Release template updates are timestamped'
);

select has_function(
  'valtrim',
  'confirm_release_template',
  array['uuid', 'valtrim.release_type', 'jsonb'],
  'The role-checked confirmation RPC is available'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.confirm_release_template(uuid,valtrim.release_type,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.confirm_release_template(uuid,valtrim.release_type,jsonb)',
    'execute'
  ),
  'Only signed-in users can call the confirmation RPC'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid =
      'private.confirm_release_template(uuid,valtrim.release_type,jsonb)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid =
      'valtrim.confirm_release_template(uuid,valtrim.release_type,jsonb)'::regprocedure
  ),
  'Confirmation uses definer rights only after its role check'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid =
      'private.confirm_release_template(uuid,valtrim.release_type,jsonb)'::regprocedure
  ), false),
  'The private confirmation function pins an empty search path'
);

select ok(
  coalesce((
    select procedure.prosrc like '%''superseded''%'
      and procedure.prosrc like '%pg_advisory_xact_lock%'
      and procedure.prosrc like '%validate_release_template_mapping%'
      and procedure.prosrc like '%has_app_role%'
    from pg_proc procedure
    where procedure.oid =
      'private.confirm_release_template(uuid,valtrim.release_type,jsonb)'::regprocedure
  ), false),
  'Confirmation validates the mapping and supersedes the previous template atomically'
);

select lives_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"through_date","target":{"kind":"rect","page":1,"x":0.1,"y":0.2,"w":0.2,"h":0.03},"fontSize":10,"format":"MM/DD/YYYY"},
        {"variable":"check_amount","target":{"kind":"rect","page":2,"x":0.6,"y":0.3,"w":0.2,"h":0.03},"fontSize":10.5,"format":"currency","cover":true}
      ]}'::jsonb,
      2
    )
  $$,
  'A valid rectangle mapping is accepted'
);

select lives_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"check_amount","target":{"kind":"acroform","fieldName":"Amount of Check"},"fontSize":10,"format":"plain"}
      ]}'::jsonb,
      1
    )
  $$,
  'A form field mapping is accepted'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"invoice_number","target":{"kind":"rect","page":1,"x":0.1,"y":0.2,"w":0.2,"h":0.03},"fontSize":10,"format":"plain"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Select a supported Release variable',
  'Variables outside the catalog are rejected'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"through_date","target":{"kind":"rect","page":1,"x":0.9,"y":0.2,"w":0.3,"h":0.03},"fontSize":10,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'The rectangle must stay inside the page',
  'Rectangles that leave the page are rejected'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"through_date","target":{"kind":"rect","page":3,"x":0.1,"y":0.2,"w":0.2,"h":0.03},"fontSize":10,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      2
    )
  $$,
  '23514',
  'The rectangle page is outside the document',
  'Pages beyond the document are rejected'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"check_amount","target":{"kind":"rect","page":1,"x":0.1,"y":0.2,"w":0.2,"h":0.03},"fontSize":10,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Select a supported format for check_amount',
  'A format must belong to its variable'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"through_date","target":{"kind":"rect","page":1,"x":0.1,"y":0.2,"w":0.2,"h":0.03},"fontSize":2,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Enter a font size between 4 and 48',
  'Unreadable font sizes are rejected'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"through_date","target":{"kind":"rect","page":1,"x":0.1,"y":0.2,"w":0,"h":0.03},"fontSize":10,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'The rectangle must stay inside the page',
  'Empty rectangles are rejected'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"through_date","target":{"kind":"rect","page":1,"x":0.1,"y":0.2,"w":0.2,"h":0.03},"fontSize":10,"format":"MM/DD/YYYY","script":"x"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Each mapped field must be an object with known properties',
  'Unknown properties are rejected so the JSON is not free-form'
);

select throws_ok(
  $$ select private.validate_release_template_mapping('{"version":1,"fields":[]}'::jsonb, 1) $$,
  '23514',
  'Map between 1 and 12 fields',
  'An empty mapping is rejected'
);

select throws_ok(
  $$ select private.validate_release_template_mapping('{"version":2,"fields":[]}'::jsonb, 1) $$,
  '23514',
  'The mapping must be a version 1 object with a fields list',
  'Only mapping version 1 is accepted'
);

select * from finish();

rollback;
