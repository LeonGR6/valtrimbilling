begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_column(
  'valtrim',
  'billing_setup_versions',
  'submission_method',
  'Builder Setup versions persist the submission method'
);

select col_not_null(
  'valtrim',
  'billing_setup_versions',
  'submission_method',
  'Every Builder Setup version has a submission method'
);

select has_column(
  'valtrim',
  'billing_setup_versions',
  'submission_destination',
  'Builder Setup versions persist the submission destination'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.billing_setup_versions'::regclass
      and conname = 'billing_setup_versions_submission_check'
      and contype = 'c'
  ),
  'Submission method and destination combinations are database constrained'
);

select ok(
  not exists (
    select 1
    from valtrim.billing_setup_versions
    where submission_method <> 'PORTAL'
  ),
  'Historical Builder Setup versions default to Portal'
);

insert into valtrim.builders (code, name)
values
  ('PHASE29EMAIL', 'Phase Twenty Nine Email Builder'),
  ('PHASE29MAIL', 'Phase Twenty Nine Mail Builder'),
  ('PHASE29LEGACY', 'Phase Twenty Nine Legacy Builder');

create temporary table phase_29_version_ids (
  email_version_id bigint,
  mail_version_id bigint,
  legacy_version_id bigint
) on commit drop;

insert into phase_29_version_ids (email_version_id)
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
    "invoiceLineFormat": "LOT_SCOPE",
    "submissionMethod": "EMAIL",
    "submissionDestination": "billing@example.com"
  }'::jsonb,
  '[
    {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
    {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
  ]'::jsonb,
  '[]'::jsonb
)
from valtrim.builders builder
where builder.code = 'PHASE29EMAIL';

select is(
  (
    select version.submission_method
    from valtrim.billing_setup_versions version
    join phase_29_version_ids ids on ids.email_version_id = version.id
  ),
  'EMAIL',
  'Builder Setup persists Email as its submission method'
);

select is(
  (
    select version.submission_destination
    from valtrim.billing_setup_versions version
    join phase_29_version_ids ids on ids.email_version_id = version.id
  ),
  'billing@example.com',
  'Builder Setup persists the submission email'
);

select is(
  (
    select version.portal_name
    from valtrim.billing_setup_versions version
    join phase_29_version_ids ids on ids.email_version_id = version.id
  ),
  null::varchar,
  'Email submissions do not populate the legacy Portal field'
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
        "invoiceLineFormat": "LOT_SCOPE",
        "submissionMethod": "EMAIL",
        "submissionDestination": "not-an-email"
      }'::jsonb,
      '[
        {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
        {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
      ]'::jsonb,
      '[]'::jsonb
    )
    from valtrim.builders builder
    where builder.code = 'PHASE29EMAIL'
  $$,
  '23514',
  'new row for relation "billing_setup_versions" violates check constraint "billing_setup_versions_submission_check"',
  'Builder Setup rejects an invalid submission email'
);

update phase_29_version_ids ids
set mail_version_id = (
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
      "invoiceLineFormat": "LOT_SCOPE",
      "submissionMethod": "MAIL",
      "submissionDestination": "100 Main St, Austin, TX 78701"
    }'::jsonb,
    '[
      {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
      {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
    ]'::jsonb,
    '[]'::jsonb
  )
  from valtrim.builders builder
  where builder.code = 'PHASE29MAIL'
);

select is(
  (
    select version.submission_method
    from valtrim.billing_setup_versions version
    join phase_29_version_ids ids on ids.mail_version_id = version.id
  ),
  'MAIL',
  'Builder Setup persists Mail as its submission method'
);

select is(
  (
    select version.submission_destination
    from valtrim.billing_setup_versions version
    join phase_29_version_ids ids on ids.mail_version_id = version.id
  ),
  '100 Main St, Austin, TX 78701',
  'Builder Setup persists the mailing address'
);

update phase_29_version_ids ids
set legacy_version_id = (
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
      "invoiceLineFormat": "LOT_SCOPE",
      "portalName": "Textura"
    }'::jsonb,
    '[
      {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
      {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
    ]'::jsonb,
    '[]'::jsonb
  )
  from valtrim.builders builder
  where builder.code = 'PHASE29LEGACY'
);

select is(
  (
    select version.submission_method
    from valtrim.billing_setup_versions version
    join phase_29_version_ids ids on ids.legacy_version_id = version.id
  ),
  'PORTAL',
  'Legacy Portal payloads default to Portal submission'
);

select is(
  (
    select version.submission_destination
    from valtrim.billing_setup_versions version
    join phase_29_version_ids ids on ids.legacy_version_id = version.id
  ),
  'Textura',
  'Legacy Portal payloads populate the new destination'
);

select is(
  (
    select version.portal_name
    from valtrim.billing_setup_versions version
    join phase_29_version_ids ids on ids.legacy_version_id = version.id
  ),
  'Textura',
  'Portal submissions keep the legacy Portal field synchronized'
);

select * from finish();

rollback;
