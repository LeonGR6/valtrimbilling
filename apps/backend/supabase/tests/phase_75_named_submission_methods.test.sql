begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- A Builder for each method, so each has a Setup version of its own.
insert into valtrim.builders (code, name)
values
  ('PHASE75SUPPLYPRO', 'Phase Seventy Five Supply Pro Builder'),
  ('PHASE75TEXTURA', 'Phase Seventy Five Textura Builder'),
  ('PHASE75KBIE', 'Phase Seventy Five KB IE Builder'),
  ('PHASE75KBLA', 'Phase Seventy Five KB LA Builder');

create temporary table phase_75_results (
  method text,
  version_id bigint
) on commit drop;

-- One Setup version for each named method, as the app saves it: no destination.
insert into phase_75_results (method, version_id)
select method.value, valtrim.save_billing_setup_version(
  builder.id,
  jsonb_build_object(
    'separateHardwarePrice', false,
    'optionsBillingDrawNumber', null,
    'frequency', 'MONTHLY',
    'cutoffAnyDate', false,
    'cutoffDay', 20,
    'cutoffDays', '[]'::jsonb,
    'cutoffWeekday', null,
    'paymentTermsDays', 30,
    'retentionEnabled', false,
    'retentionPercentage', 0,
    'wrapEnabled', false,
    'wrapPercentage', 0,
    'invoiceLineFormat', 'LOT_SCOPE',
    'submissionMethod', method.value,
    'submissionDestination', ''
  ),
  '[
    {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
    {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
  ]'::jsonb,
  '[]'::jsonb
)
from (
  values
    ('SUPPLY_PRO', 'PHASE75SUPPLYPRO'),
    ('TEXTURA', 'PHASE75TEXTURA'),
    ('KB_IE', 'PHASE75KBIE'),
    ('KB_LA', 'PHASE75KBLA')
) as method(value, builder_code)
join valtrim.builders builder on builder.code = method.builder_code;

select is(
  (
    select count(*)
    from valtrim.billing_setup_versions version
    join phase_75_results result on result.version_id = version.id
    where version.submission_method = result.method
  ),
  4::bigint,
  'Builder Setup persists Supply Pro, Textura, KB IE and KB LA as submission methods'
);

select is(
  (
    select count(*)
    from valtrim.billing_setup_versions version
    join phase_75_results result on result.version_id = version.id
    where version.submission_destination is null
      and version.portal_name is null
  ),
  4::bigint,
  'A named submission method stores no destination and leaves the legacy Portal field empty'
);

select throws_ok(
  $sql$
    update valtrim.billing_setup_versions
    set submission_destination = 'Another portal'
    where id = (select version_id from phase_75_results where method = 'TEXTURA')
  $sql$,
  '23514',
  'new row for relation "billing_setup_versions" violates check constraint "billing_setup_versions_submission_check"',
  'A named submission method rejects a destination'
);

select throws_ok(
  $sql$
    update valtrim.billing_setup_versions
    set submission_method = 'NOT_A_METHOD'
    where id = (select version_id from phase_75_results where method = 'KB_IE')
  $sql$,
  '23514',
  'new row for relation "billing_setup_versions" violates check constraint "billing_setup_versions_submission_check"',
  'An unknown submission method is still rejected'
);

-- A destination typed under Portal is not carried over to a named method.
select throws_ok(
  $sql$
    select valtrim.save_billing_setup_version(
      (select id from valtrim.builders where code = 'PHASE75KBLA'),
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
        "invoiceLineFormat": "LOT_SCOPE",
        "submissionMethod": "KB_LA",
        "submissionDestination": "Leftover portal name"
      }'::jsonb,
      '[
        {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
        {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
      ]'::jsonb,
      '[]'::jsonb
    )
  $sql$,
  '23514',
  'new row for relation "billing_setup_versions" violates check constraint "billing_setup_versions_submission_check"',
  'A named submission method is not saved with a leftover destination'
);

-- Portal, Email and Mail keep working as before.
select lives_ok(
  $sql$
    update valtrim.billing_setup_versions
    set submission_method = 'PORTAL', submission_destination = 'Textura', portal_name = 'Textura'
    where id = (select version_id from phase_75_results where method = 'SUPPLY_PRO')
  $sql$,
  'Portal still takes an optional name'
);

select lives_ok(
  $sql$
    update valtrim.billing_setup_versions
    set submission_method = 'EMAIL', submission_destination = 'billing@example.com', portal_name = null
    where id = (select version_id from phase_75_results where method = 'SUPPLY_PRO')
  $sql$,
  'Email still takes an email address'
);

select throws_ok(
  $sql$
    update valtrim.billing_setup_versions
    set submission_method = 'EMAIL', submission_destination = null
    where id = (select version_id from phase_75_results where method = 'SUPPLY_PRO')
  $sql$,
  '23514',
  'new row for relation "billing_setup_versions" violates check constraint "billing_setup_versions_submission_check"',
  'Email still needs its address'
);

select throws_ok(
  $sql$
    update valtrim.billing_setup_versions
    set submission_method = 'MAIL', submission_destination = null
    where id = (select version_id from phase_75_results where method = 'SUPPLY_PRO')
  $sql$,
  '23514',
  'new row for relation "billing_setup_versions" violates check constraint "billing_setup_versions_submission_check"',
  'Mail still needs its address'
);

select * from finish();

rollback;
