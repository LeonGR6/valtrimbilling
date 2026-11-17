begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_column(
  'valtrim',
  'billing_draws',
  'event_type',
  'Billing Draws store their production event type'
);
select col_not_null(
  'valtrim',
  'billing_draws',
  'event_type',
  'Every Billing Draw requires a production event type'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.billing_draws'::regclass
      and conname = 'billing_draws_event_type_check'
      and contype = 'c'
  ),
  'Billing Draw event types are constrained'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.billing_draws'::regclass
      and tgname = 'billing_draws_protect'
      and tgenabled = 'O'
  ),
  'The Billing Draw immutability trigger remains enabled'
);
select ok(
  not exists (
    select 1
    from valtrim.billing_draws
    where event_type is null
       or event_type::text not in ('EXT', 'DM', 'HW')
  ),
  'Existing Billing Draws are classified with a supported event'
);
select throws_ok(
  $$
    select valtrim.save_billing_setup_version(
      -1,
      '{}'::jsonb,
      '[{"drawNumber": 1, "percentage": 100, "eventType": "SHUTTER"}]'::jsonb,
      '[]'::jsonb
    )
  $$,
  '23514',
  'Cada draw debe tener un event type EXT, DM o HW',
  'The setup RPC rejects unsupported Draw event types'
);

insert into valtrim.builders (code, name)
values ('PHASE25PGTAP', 'Phase Twenty Five PgTap Builder');

create temporary table phase_25_version_ids (
  version_id bigint
) on commit drop;

insert into phase_25_version_ids (version_id)
select valtrim.save_billing_setup_version(
  builder.id,
  '{
    "separateHardwarePrice": false,
    "optionsBillingDrawNumber": null,
    "frequency": "MONTHLY",
    "cutoffDay": 20,
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
    {"drawNumber": 1, "name": "First HW", "percentage": 50, "eventType": "HW"},
    {"drawNumber": 2, "name": "Second HW", "percentage": 50, "eventType": "HW"}
  ]'::jsonb,
  '[]'::jsonb
)
from valtrim.builders builder
where builder.code = 'PHASE25PGTAP';

select is(
  (
    select count(*)
    from valtrim.billing_draws draw
    join phase_25_version_ids ids on ids.version_id = draw.setup_version_id
    where draw.event_type = 'HW'
  ),
  2::bigint,
  'The setup RPC persists the event for every Draw'
);
select is(
  (
    select count(distinct draw.event_type)
    from valtrim.billing_draws draw
    join phase_25_version_ids ids on ids.version_id = draw.setup_version_id
  ),
  1::bigint,
  'One production event can be assigned to multiple Draws'
);

select * from finish();

rollback;
