begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_column(
  'valtrim',
  'billing_setup_versions',
  'single_invoice_scope',
  'Setup versions store whether the Builder takes a single invoice per Phase or Building'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.billing_setup_versions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%single_invoice_scope%'
      and pg_get_constraintdef(oid) like '%PHASE%'
      and pg_get_constraintdef(oid) like '%BUILDING%'
      and pg_get_constraintdef(oid) not like '%PROJECT%'
  ),
  'The scope is limited to PHASE or BUILDING (or not configured)'
);

select is(
  (select count(*) from valtrim.billing_setup_versions where single_invoice_scope is not null),
  0::bigint,
  'Existing setups stay unconfigured'
);

select throws_ok(
  $$
    select valtrim.save_billing_setup_version(
      0,
      '{"singleInvoiceScope":"JOB"}'::jsonb,
      '[{"eventType":"EXT"}]'::jsonb,
      '[]'::jsonb
    )
  $$,
  '23514',
  'Select Per Phase or Per Building for the single invoice',
  'An unknown scope is rejected'
);

select throws_ok(
  $$
    select valtrim.save_billing_setup_version(
      0,
      '{"singleInvoiceScope":"BUILDING"}'::jsonb,
      '[{"eventType":"EXT"}]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'Builder 0 no existe o no tiene billing setup',
  'A valid scope passes validation and reaches the Builder lookup'
);

select ok(
  coalesce((
    select procedure.prosrc like '%singleInvoiceScope%'
      and procedure.prosrc like '%single_invoice_scope = v_single_invoice_scope%'
      and procedure.prosrc like '%final_release_scope = v_final_release_scope%'
    from pg_proc procedure
    where procedure.oid =
      'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
  ), false),
  'Both the new-version and the draft-update paths save the scope, next to the Final Release scope'
);

select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.billing_setup_versions',
    'single_invoice_scope',
    'SELECT'
  ),
  'Authenticated users can read the scope with the rest of the setup'
);

select * from finish();

rollback;
