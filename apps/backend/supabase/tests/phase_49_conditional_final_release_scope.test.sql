begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_column(
  'valtrim',
  'billing_setup_versions',
  'final_release_scope',
  'Setup versions store how the Conditional Final Release is handled'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.billing_setup_versions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%final_release_scope%'
      and pg_get_constraintdef(oid) like '%PHASE%'
      and pg_get_constraintdef(oid) like '%BUILDING%'
      and pg_get_constraintdef(oid) like '%PROJECT%'
  ),
  'The scope is limited to PHASE, BUILDING or PROJECT (or not configured)'
);

select col_is_null(
  'valtrim',
  'billing_setup_versions',
  'final_release_scope',
  'Existing setups stay unconfigured'
);

select throws_ok(
  $$
    select valtrim.save_billing_setup_version(
      0,
      '{"finalReleaseScope":"GLOBAL"}'::jsonb,
      '[{"eventType":"EXT"}]'::jsonb,
      '[{"type":"RELEASE","label":"Release","required":true}]'::jsonb
    )
  $$,
  '23514',
  'Select Per Phase, Per Building or Per Project for the Conditional Final Release',
  'An unknown scope is rejected'
);

select throws_ok(
  $$
    select valtrim.save_billing_setup_version(
      0,
      '{"finalReleaseScope":"PHASE"}'::jsonb,
      '[{"eventType":"EXT"}]'::jsonb,
      '[{"type":"PURCHASE_ORDER","label":"Purchase order","required":true}]'::jsonb
    )
  $$,
  '23514',
  'The Conditional Final Release scope needs Release to be required to submit',
  'A scope without a required Release is rejected'
);

select throws_ok(
  $$
    select valtrim.save_billing_setup_version(
      0,
      '{"finalReleaseScope":"PHASE"}'::jsonb,
      '[{"eventType":"EXT"}]'::jsonb,
      '[{"type":"RELEASE","label":"Release","required":false}]'::jsonb
    )
  $$,
  '23514',
  'The Conditional Final Release scope needs Release to be required to submit',
  'A Release that is not required does not allow a scope'
);

select throws_ok(
  $$
    select valtrim.save_billing_setup_version(
      0,
      '{"finalReleaseScope":"PROJECT"}'::jsonb,
      '[{"eventType":"EXT"}]'::jsonb,
      '[{"type":"RELEASE","label":"Release","required":true}]'::jsonb
    )
  $$,
  'P0001',
  'Builder 0 no existe o no tiene billing setup',
  'A valid scope with a required Release passes validation and reaches the Builder lookup'
);

select ok(
  coalesce((
    select procedure.prosrc like '%finalReleaseScope%'
      and procedure.prosrc like '%final_release_scope = v_final_release_scope%'
    from pg_proc procedure
    where procedure.oid =
      'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
  ), false),
  'Both the new-version and the draft-update paths save the scope'
);

select has_function(
  'private',
  'get_final_release_status',
  array['bigint'],
  'The final Release rule is available'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.get_final_release_status(bigint)'::regprocedure
  )
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.get_final_release_status(bigint)'::regprocedure
  ), false),
  'The rule runs with definer rights and an empty search path'
);

select ok(
  not has_function_privilege('authenticated', 'private.get_final_release_status(bigint)', 'execute')
  and not has_function_privilege('anon', 'private.get_final_release_status(bigint)', 'execute')
  and has_function_privilege('service_role', 'private.get_final_release_status(bigint)', 'execute'),
  'Only the values RPC reaches the rule; it is not exposed to browsers'
);

select ok(
  coalesce((
    select procedure.prosrc like '%package_type <> ''DRAW''%'
      and procedure.prosrc like '%RETENTION_RELEASE%'
      and procedure.prosrc like '%NOT_CONFIGURED%'
      and procedure.prosrc like '%package.status <> ''VOIDED''%'
      and procedure.prosrc like '%current_setup%'
    from pg_proc procedure
    where procedure.oid = 'private.get_final_release_status(bigint)'::regprocedure
  ), false),
  'Retention Releases and unconfigured setups are not evaluated, voided Packages never count, and the Builder current setup is the fallback'
);

select ok(
  coalesce((
    select procedure.prosrc like '%closes%'
      and procedure.prosrc like '%covered_before < stats.total%'
      and procedure.prosrc like '%v_closing = v_touched%'
    from pg_proc procedure
    where procedure.oid = 'private.get_final_release_status(bigint)'::regprocedure
  ), false),
  'A Package is final only when it finishes every scope it touches'
);

select is(
  private.get_final_release_status(0),
  null,
  'A Package that does not exist has no status'
);

select ok(
  coalesce((
    select procedure.prosrc like '%final_release%get_final_release_status%'
      or (procedure.prosrc like '%''final_release''%'
          and procedure.prosrc like '%private.get_final_release_status(p_package_id)%')
    from pg_proc procedure
    where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'The Package values include the final Release status'
);

select ok(
  coalesce((
    select procedure.prosrc like '%''package_type''%'
      and procedure.prosrc like '%pending_packages%'
    from pg_proc procedure
    where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'The Package values still include the pending Packages and now the Package type'
);

select * from finish();

rollback;
