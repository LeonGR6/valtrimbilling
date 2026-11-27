begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_column(
  'valtrim',
  'plans',
  'display_order',
  'Plans store their position within the Job'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.plans', 'display_order', 'update'),
  'The order cannot be written directly from the browser'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.plans', 'display_order', 'insert'),
  'A new Plan cannot choose its own position'
);

select has_function(
  'valtrim',
  'reorder_job_plans',
  array['bigint', 'bigint[]'],
  'Plans are reordered through one function'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.reorder_job_plans(bigint, bigint[])', 'execute')
  and not has_function_privilege('anon', 'valtrim.reorder_job_plans(bigint, bigint[])', 'execute'),
  'Only signed-in users can call it'
);

select has_trigger(
  'valtrim',
  'plans',
  'set_plan_display_order',
  'A new Plan goes to the end of its Job'
);

select ok(
  not exists (
    select 1
    from valtrim.plans
    where display_order < 1
  ),
  'Every Plan has a position'
);

select * from finish();

rollback;
