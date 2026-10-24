begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select has_column(
  'valtrim',
  'billing_setup_versions',
  'utility_building',
  'Builder Setup versions store the Utility Building flag'
);

select col_type_is(
  'valtrim',
  'billing_setup_versions',
  'utility_building',
  'boolean',
  'Utility Building is a boolean flag'
);

select col_not_null(
  'valtrim',
  'billing_setup_versions',
  'utility_building',
  'Utility Building always has an explicit state'
);

select col_default_is(
  'valtrim',
  'billing_setup_versions',
  'utility_building',
  'false',
  'Existing and new Builder Setups default Utility Building to inactive'
);

select ok(coalesce((
  select procedure.prosrc like '%p_config->>''utilityBuilding''%'
    and procedure.prosrc like '%utility_building%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
), false), 'The Builder Setup save function persists Utility Building');

insert into valtrim.builders (code, name)
values ('UTILITYPGTAP', 'Utility Building PgTap Builder');

create temporary table phase_31_version_ids (
  version_id bigint
) on commit drop;

insert into phase_31_version_ids (version_id)
select valtrim.save_billing_setup_version(
  builder.id,
  '{
    "separateHardwarePrice": false,
    "utilityBuilding": true,
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
    "submissionMethod": "PORTAL",
    "submissionDestination": null,
    "notes": null
  }'::jsonb,
  '[
    {"drawNumber": 1, "name": "Start", "percentage": 50, "eventType": "EXT"},
    {"drawNumber": 2, "name": "Final", "percentage": 50, "eventType": "DM"}
  ]'::jsonb,
  '[]'::jsonb
)
from valtrim.builders builder
where builder.code = 'UTILITYPGTAP';

select ok(
  exists (
    select 1
    from valtrim.billing_setup_versions version
    join phase_31_version_ids ids on ids.version_id = version.id
    where version.utility_building
  ),
  'Saving a Builder Setup can activate Utility Building'
);

select * from finish();

rollback;
