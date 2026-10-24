begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_column(
  'valtrim',
  'billing_setup_versions',
  'cutoff_any_date',
  'Billing Setup versions persist monthly Any date mode'
);

select col_not_null(
  'valtrim',
  'billing_setup_versions',
  'cutoff_any_date',
  'Every Billing Setup version has an explicit Any date mode'
);

select col_default_is(
  'valtrim',
  'billing_setup_versions',
  'cutoff_any_date',
  'false',
  'Historical and fixed-cutoff versions default to Any date off'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.billing_setup_versions'::regclass
      and conname = 'billing_setup_versions_frequency_cutoff_check'
      and contype = 'c'
  ),
  'Frequency and Any date combinations remain database constrained'
);

insert into valtrim.builders (code, name)
values ('PHASE27PGTAP', 'Phase Twenty Seven PgTap Builder');

create temporary table phase_27_version_ids (
  version_id bigint
) on commit drop;

insert into phase_27_version_ids (version_id)
select valtrim.save_billing_setup_version(
  builder.id,
  '{
    "separateHardwarePrice": false,
    "optionsBillingDrawNumber": null,
    "frequency": "MONTHLY",
    "cutoffAnyDate": true,
    "cutoffDay": null,
    "cutoffDays": [],
    "cutoffWeekday": null,
    "paymentTermsDays": 30,
    "retentionEnabled": false,
    "retentionPercentage": 0,
    "wrapEnabled": false,
    "wrapPercentage": 0,
    "invoiceLineFormat": "LOT_SCOPE"
  }'::jsonb,
  '[
    {"drawNumber": 1, "name": "Exterior", "percentage": 50, "eventType": "EXT"},
    {"drawNumber": 2, "name": "Door and millwork", "percentage": 50, "eventType": "DM"}
  ]'::jsonb,
  '[]'::jsonb
)
from valtrim.builders builder
where builder.code = 'PHASE27PGTAP';

select is(
  (
    select version.cutoff_any_date
    from valtrim.billing_setup_versions version
    join phase_27_version_ids ids on ids.version_id = version.id
  ),
  true,
  'The setup save path persists Any date'
);

select is(
  (
    select version.cutoff_day
    from valtrim.billing_setup_versions version
    join phase_27_version_ids ids on ids.version_id = version.id
  ),
  null::smallint,
  'Any date stores no fixed monthly cutoff day'
);

select ok(coalesce((
  select procedure.prosrc like '%cutoffAnyDate%'
    and procedure.prosrc like '%cutoff_any_date%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
), false), 'The atomic setup save handles Any date');

select ok(
  not exists (
    select 1
    from valtrim.billing_setup_versions
    where cutoff_any_date
      and (
        frequency <> 'MONTHLY'
        or cutoff_day is not null
        or cardinality(cutoff_days) <> 0
        or cutoff_weekday is not null
      )
  ),
  'Stored Any date versions cannot retain another cutoff rule'
);

select * from finish();

rollback;
