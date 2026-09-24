begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

select has_table(
  'valtrim',
  'billing_setup_versions',
  'Billing setup versions table is available'
);
select has_table('valtrim', 'billing_draws', 'Billing draws table is available');
select has_table(
  'valtrim',
  'billing_required_documents',
  'Billing required documents table is available'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.billing_setup_versions', 'select'),
  'Authenticated users can select completed setup versions subject to RLS'
);
select ok(
  has_table_privilege('authenticated', 'valtrim.billing_draws', 'select'),
  'Authenticated users can select billing draws subject to RLS'
);
select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.billing_required_documents',
    'select'
  ),
  'Authenticated users can select required documents subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.billing_setup_versions', 'insert'),
  'Browser clients cannot insert setup versions directly'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.billing_setup_versions', 'update'),
  'Browser clients cannot update setup versions directly'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.billing_setup_versions', 'delete'),
  'Browser clients cannot delete setup versions directly'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.billing_draws', 'insert'),
  'Browser clients cannot insert billing draws directly'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.billing_draws', 'update'),
  'Browser clients cannot update billing draws directly'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.billing_draws', 'delete'),
  'Browser clients cannot delete billing draws directly'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.billing_required_documents',
    'insert'
  ),
  'Browser clients cannot insert required documents directly'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.billing_required_documents',
    'update'
  ),
  'Browser clients cannot update required documents directly'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.billing_required_documents',
    'delete'
  ),
  'Browser clients cannot delete required documents directly'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.billing_setup_versions_id_seq',
    'usage'
  ),
  'Only the audited RPC can allocate setup version identities'
);
select ok(
  not has_sequence_privilege('authenticated', 'valtrim.billing_draws_id_seq', 'usage'),
  'Only the audited RPC can allocate billing draw identities'
);
select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.billing_required_documents_id_seq',
    'usage'
  ),
  'Only the audited RPC can allocate required document identities'
);

select has_function(
  'valtrim',
  'save_builder_billing_setup',
  array['bigint', 'jsonb', 'jsonb', 'jsonb'],
  'Atomic Builder billing setup save function is available'
);
select has_function(
  'valtrim',
  'deactivate_builder_billing_setup',
  array['bigint'],
  'Non-destructive Builder billing setup deactivation function is available'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'valtrim.save_builder_billing_setup(bigint, jsonb, jsonb, jsonb)'::regprocedure
  ),
  'Atomic setup save uses definer rights after its internal role check'
);
select ok(
  coalesce((
    select array_to_string(function_record.proconfig, ',') = 'search_path=""'
    from pg_proc function_record
    where function_record.oid =
      'valtrim.save_builder_billing_setup(bigint, jsonb, jsonb, jsonb)'::regprocedure
  ), false),
  'Atomic setup save has an empty search path'
);
select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.save_builder_billing_setup(bigint, jsonb, jsonb, jsonb)',
    'execute'
  ),
  'Authenticated users can call setup save subject to its role check'
);
select ok(
  not has_function_privilege(
    'anon',
    'valtrim.save_builder_billing_setup(bigint, jsonb, jsonb, jsonb)',
    'execute'
  ),
  'Anonymous clients cannot call setup save'
);
select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.deactivate_builder_billing_setup(bigint)',
    'execute'
  ),
  'Authenticated users can call setup deactivation subject to its role check'
);
select ok(
  not has_function_privilege(
    'anon',
    'valtrim.deactivate_builder_billing_setup(bigint)',
    'execute'
  ),
  'Anonymous clients cannot call setup deactivation'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in (
        'billing_setup_versions',
        'billing_draws',
        'billing_required_documents'
      )
  ),
  3::bigint,
  'Setup versions, draws and documents have one read policy each'
);

insert into valtrim.builders (code, name)
values ('PHASE4PGTAP', 'Phase Four PgTap Builder');

create temporary table phase_4_version_ids (
  first_version_id bigint,
  second_version_id bigint
) on commit drop;

insert into phase_4_version_ids (first_version_id)
select valtrim.save_billing_setup_version(
  builder.id,
  '{
    "separateHardwarePrice": false,
    "optionsBillingDrawNumber": 2,
    "frequency": "MONTHLY",
    "cutoffDay": 20,
    "submissionDay": 25,
    "cutoffDays": [],
    "cutoffWeekday": null,
    "submissionOffsetDays": null,
    "workAcceptedThrough": "CUTOFF",
    "invoiceDateRule": "SUBMISSION",
    "paymentTermsDays": 30,
    "retentionEnabled": true,
    "retentionPercentage": 5,
    "wrapEnabled": false,
    "wrapPercentage": 0,
    "invoiceLineFormat": "LOT_SCOPE",
    "portalName": "Builder Portal",
    "notes": "Initial version"
  }'::jsonb,
  '[
    {"drawNumber": 1, "name": "Start", "percentage": 25},
    {"drawNumber": 2, "name": "Final", "percentage": 75}
  ]'::jsonb,
  '[
    {"type": "PURCHASE_ORDER", "label": "Purchase order", "required": true, "displayOrder": 1}
  ]'::jsonb
)
from valtrim.builders builder
where builder.code = 'PHASE4PGTAP';

select valtrim.activate_billing_setup_version(first_version_id)
from phase_4_version_ids;

select is(
  (
    select count(*)
    from valtrim.billing_setup_versions version
    join valtrim.builders builder on builder.id = version.builder_id
    where builder.code = 'PHASE4PGTAP'
      and version.status = 'ACTIVE'
  ),
  1::bigint,
  'A valid setup version can be activated'
);
select is(
  (
    select count(*)
    from valtrim.billing_draws draw
    join phase_4_version_ids ids on ids.first_version_id = draw.setup_version_id
  ),
  2::bigint,
  'The setup stores all configured draws'
);
select is(
  (
    select sum(draw.percentage)::numeric
    from valtrim.billing_draws draw
    join phase_4_version_ids ids on ids.first_version_id = draw.setup_version_id
  ),
  100::numeric,
  'Persisted draw percentages total exactly 100'
);
select is(
  (
    select count(*)
    from valtrim.billing_required_documents document
    join phase_4_version_ids ids on ids.first_version_id = document.setup_version_id
    where document.is_required
  ),
  2::bigint,
  'Invoice and selected submission documents are persisted'
);

update phase_4_version_ids ids
set second_version_id = (
  select valtrim.save_billing_setup_version(
    builder.id,
    '{
      "separateHardwarePrice": true,
      "hardwareBillingDrawNumber": 2,
      "optionsBillingDrawNumber": 1,
      "frequency": "WEEKLY",
      "cutoffDay": null,
      "submissionDay": null,
      "cutoffDays": [],
      "cutoffWeekday": 5,
      "submissionOffsetDays": 2,
      "workAcceptedThrough": "SUBMISSION",
      "invoiceDateRule": "CUTOFF",
      "paymentTermsDays": 45,
      "retentionEnabled": true,
      "retentionPercentage": 5,
      "wrapEnabled": true,
      "wrapPercentage": 2,
      "invoiceLineFormat": "LOT",
      "portalName": "Textura",
      "notes": "Replacement version"
    }'::jsonb,
    '[
      {"drawNumber": 1, "name": "Trim", "percentage": 85},
      {"drawNumber": 2, "name": "Hardware", "percentage": 15}
    ]'::jsonb,
    '[
      {"type": "RELEASE", "label": "Release", "required": true, "displayOrder": 1},
      {"type": "BACKUP", "label": "Backup documentation", "required": true, "displayOrder": 2}
    ]'::jsonb
  )
  from valtrim.builders builder
  where builder.code = 'PHASE4PGTAP'
);

select valtrim.activate_billing_setup_version(second_version_id)
from phase_4_version_ids;

select is(
  (
    select version.status::text
    from valtrim.billing_setup_versions version
    join phase_4_version_ids ids on ids.first_version_id = version.id
  ),
  'SUPERSEDED',
  'Activating a replacement preserves the previous version as superseded'
);
select is(
  (
    select count(*)
    from valtrim.billing_setup_versions version
    join valtrim.builders builder on builder.id = version.builder_id
    where builder.code = 'PHASE4PGTAP'
      and version.status = 'ACTIVE'
  ),
  1::bigint,
  'A Builder has at most one active billing setup version'
);
select ok(
  exists (
    select 1
    from valtrim.billing_setup_versions version
    join phase_4_version_ids ids on ids.second_version_id = version.id
    where version.separate_hardware_price
      and version.hardware_billing_draw_number = 2
      and version.options_billing_draw_number = 1
      and version.wrap_enabled
      and version.wrap_percentage = 2
  ),
  'Replacement version stores Hardware, Options and OCIP or WRAP configuration'
);
select is(
  (
    select count(*)
    from valtrim.billing_required_documents document
    join phase_4_version_ids ids on ids.second_version_id = document.setup_version_id
    where document.is_required
  ),
  3::bigint,
  'Replacement version stores Invoice, Release and Backup requirements'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.plans', 'select'),
  'Unopened Plans remain closed after the Builder billing setup phase'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.communities', 'select'),
  'Communities remain closed after the Builder billing setup phase'
);

select * from finish();

rollback;
