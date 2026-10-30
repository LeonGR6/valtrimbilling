begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_table(
  'valtrim',
  'payment_schedule_templates',
  'Payment Schedule templates are persisted'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.payment_schedule_templates'::regclass),
  'Payment Schedule templates have RLS enabled'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.payment_schedule_templates', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.payment_schedule_templates', 'update')
  and not has_table_privilege('authenticated', 'valtrim.payment_schedule_templates', 'delete')
  and has_table_privilege('authenticated', 'valtrim.payment_schedule_templates', 'select')
  and not has_table_privilege('anon', 'valtrim.payment_schedule_templates', 'select'),
  'Browsers can only read Payment Schedule templates and anonymous users cannot'
);

select ok(
  has_table_privilege('service_role', 'valtrim.payment_schedule_templates', 'insert')
  and has_table_privilege('service_role', 'valtrim.payment_schedule_templates', 'update'),
  'The analyze Edge Function can write analysis results as service_role'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'payment_schedule_templates'
  $$,
  $$ values ('payment_schedule_templates_select') $$,
  'Payment Schedule templates expose only their active-user read policy'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.payment_schedule_templates'::regclass
      and confrelid = 'valtrim.job_documents'::regclass
      and contype = 'f'
      and confdeltype = 'c'
  ),
  'Deleting a Job document deletes its Payment Schedule template'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.payment_schedule_templates'::regclass
      and contype = 'u'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'valtrim.payment_schedule_templates'::regclass
          and attname = 'job_document_id'
      )]
  ),
  'A document has at most one Payment Schedule template'
);

select has_trigger(
  'valtrim',
  'payment_schedule_templates',
  'payment_schedule_templates_sync_document',
  'The Job is derived from the PAYMENT_SCHEDULE or PURCHASE_ORDER document'
);

select has_trigger(
  'valtrim',
  'payment_schedule_templates',
  'payment_schedule_templates_set_updated_at',
  'Payment Schedule template updates are timestamped'
);

select has_function(
  'valtrim',
  'confirm_payment_schedule_template',
  array['uuid', 'jsonb'],
  'The role-checked confirmation RPC is available'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.confirm_payment_schedule_template(uuid,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.confirm_payment_schedule_template(uuid,jsonb)',
    'execute'
  ),
  'Only signed-in users can call the confirmation RPC'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid =
      'private.confirm_payment_schedule_template(uuid,jsonb)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid =
      'valtrim.confirm_payment_schedule_template(uuid,jsonb)'::regprocedure
  ),
  'Confirmation uses definer rights only after its role check'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid =
      'private.confirm_payment_schedule_template(uuid,jsonb)'::regprocedure
  ), false),
  'The private confirmation function pins an empty search path'
);

select ok(
  coalesce((
    select procedure.prosrc like '%validate_payment_schedule_mapping%'
      and procedure.prosrc like '%has_app_role%'
    from pg_proc procedure
    where procedure.oid =
      'private.confirm_payment_schedule_template(uuid,jsonb)'::regprocedure
  ), false),
  'Confirmation checks the role and validates the mapping'
);

select lives_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"line_items","cells":[
        {"phase":"003","lot":"0014","draw":2,"amount":1446.78,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}},
        {"phase":"003","lot":"0014","draw":3,"amount":482.26,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}},
        {"phase":null,"lot":"1","draw":2,"amount":1446.78,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}
      ]}'::jsonb,
      1
    )
  $$,
  'A valid set of cells is accepted'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":2,"layout":"matrix","cells":[{"phase":"003","lot":"0014","draw":2,"amount":1446.78,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}]}'::jsonb,
      1
    )
  $$,
  '23514',
  'The mapping must be a version 1 object with a layout and a cells list',
  'Only mapping version 1 is accepted'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[{"phase":"003","lot":"0014","draw":6,"amount":1446.78,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Each cell needs a draw number from 1 to 5',
  'Draws outside the Billing Setup range are rejected'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[{"phase":"003","lot":"0014","draw":2,"amount":1.234,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Each cell needs an amount with at most two decimals',
  'Amounts with more than two decimals are rejected'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[{"phase":"003","lot":"0014","draw":2,"amount":1446.78,"page":2,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}]}'::jsonb,
      1
    )
  $$,
  '23514',
  'The cell page is outside the document',
  'Pages beyond the document are rejected'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[{"phase":"003","lot":"0014","draw":2,"amount":1446.78,"page":1,"rect":{"x":0.9,"y":0.2,"w":0.3,"h":0.01}}]}'::jsonb,
      1
    )
  $$,
  '23514',
  'The cell rectangle must stay inside the page',
  'Rectangles that leave the page are rejected'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[{"phase":"003","lot":"0014","draw":2,"amount":1446.78,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}},{"phase":"003","lot":"0014","draw":2,"amount":1446.78,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Each Phase, Lot and draw can appear only once',
  'A Phase, Lot and draw can appear only once'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[{"phase":"003","lot":"0014","draw":2,"amount":1446.78,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01},"script":"x"}]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Each cell must be an object with known properties',
  'Unknown properties are rejected so the JSON is not free-form'
);

select * from finish();

rollback;
