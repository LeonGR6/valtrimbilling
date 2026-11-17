begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_function(
  'valtrim',
  'set_job_prices',
  array['bigint', 'jsonb', 'jsonb'],
  'Many Plan and Option prices of a Job can be saved in one call'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.set_job_prices(bigint,jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.set_job_prices(bigint,jsonb,jsonb)',
    'execute'
  ),
  'Authenticated users can save the prices; anonymous clients cannot'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure
  ),
  'The save runs as SECURITY DEFINER after checking the role itself'
);

select ok(
  pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%private.has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%',
  'Only Admin and Project Management can save prices'
);

select ok(
  pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%valtrim.set_plan_price(%'
  and pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%valtrim.set_option_price(%',
  'Each price goes through the single-price functions, so their rules do not change'
);

select ok(
  pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%plan.job_id = p_job_id%'
  and pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%A Plan is no longer in the Job%'
  and pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%An Option is no longer in the Job%',
  'Every Plan and Option must belong to the Job'
);

select ok(
  pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%A Plan or an Option price is repeated%',
  'A Plan or Option price cannot be repeated in one save'
);

select ok(
  pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%order by (item.value ->> ''plan_id'')::bigint%'
  and pg_get_functiondef('valtrim.set_job_prices(bigint,jsonb,jsonb)'::regprocedure)
    like '%order by (item.value ->> ''option_id'')::bigint%',
  'Prices are saved in id order, so two saves lock rows in the same order'
);

select * from finish();

rollback;
