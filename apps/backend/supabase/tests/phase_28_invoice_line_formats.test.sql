begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select ok(
  exists (
    select 1
    from pg_type type_record
    join pg_namespace namespace_record
      on namespace_record.oid = type_record.typnamespace
    join pg_enum enum_record
      on enum_record.enumtypid = type_record.oid
    where namespace_record.nspname = 'valtrim'
      and type_record.typname = 'invoice_line_format'
      and enum_record.enumlabel = 'BUILDING_SCOPE'
  ),
  'Invoice line formats include Building and Scope'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.billing_setup_versions'::regclass
      and constraint_record.conname =
        'billing_setup_versions_invoice_line_format_check'
      and constraint_record.contype = 'c'
  ),
  'Builder Setup invoice line formats are database constrained'
);

select ok(
  exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'valtrim.billing_setup_versions'::regclass
      and trigger_record.tgname = 'billing_setup_versions_protect'
      and trigger_record.tgenabled = 'O'
  ),
  'Builder Setup version immutability is restored after normalization'
);

select ok(
  not exists (
    select 1
    from valtrim.billing_setup_versions
    where invoice_line_format not in ('LOT_SCOPE', 'BUILDING_SCOPE')
  ),
  'Existing Builder Setups use a supported invoice line format'
);

insert into valtrim.builders (code, name)
values ('PHASE28PGTAP', 'Phase Twenty Eight PgTap Builder');

create temporary table phase_28_version_ids (
  version_id bigint
) on commit drop;

insert into phase_28_version_ids (version_id)
select valtrim.save_billing_setup_version(
  builder.id,
  '{
    "separateHardwarePrice": false,
    "optionsBillingDrawNumber": null,
    "frequency": "MONTHLY",
    "cutoffAnyDate": false,
    "cutoffDay": 20,
    "cutoffDays": [],
    "cutoffWeekday": null,
    "paymentTermsDays": 30,
    "retentionEnabled": false,
    "retentionPercentage": 0,
    "wrapEnabled": false,
    "wrapPercentage": 0,
    "invoiceLineFormat": "BUILDING_SCOPE"
  }'::jsonb,
  '[
    {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
    {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
  ]'::jsonb,
  '[]'::jsonb
)
from valtrim.builders builder
where builder.code = 'PHASE28PGTAP';

select is(
  (
    select version.invoice_line_format::text
    from valtrim.billing_setup_versions version
    join phase_28_version_ids ids on ids.version_id = version.id
  ),
  'BUILDING_SCOPE',
  'Builder Setup persists Building and Scope invoice lines'
);

select throws_ok(
  $$
    select valtrim.save_billing_setup_version(
      builder.id,
      '{
        "separateHardwarePrice": false,
        "optionsBillingDrawNumber": null,
        "frequency": "MONTHLY",
        "cutoffAnyDate": false,
        "cutoffDay": 20,
        "cutoffDays": [],
        "cutoffWeekday": null,
        "paymentTermsDays": 30,
        "retentionEnabled": false,
        "retentionPercentage": 0,
        "wrapEnabled": false,
        "wrapPercentage": 0,
        "invoiceLineFormat": "LOT"
      }'::jsonb,
      '[
        {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
        {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
      ]'::jsonb,
      '[]'::jsonb
    )
    from valtrim.builders builder
    where builder.code = 'PHASE28PGTAP'
  $$,
  '23514',
  'new row for relation "billing_setup_versions" violates check constraint "billing_setup_versions_invoice_line_format_check"',
  'Builder Setup rejects legacy invoice line formats'
);

select * from finish();

rollback;
