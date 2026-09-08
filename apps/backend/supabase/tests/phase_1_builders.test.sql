begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_table('valtrim', 'builders', 'Builders table is available');
select has_table('valtrim', 'billing_setups', 'Billing setups table is available');

select ok(
  has_table_privilege('authenticated', 'valtrim.builders', 'select'),
  'Authenticated users can select builders subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.builders', 'code', 'insert'),
  'Authenticated users can insert catalog fields subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.builders', 'code', 'update'),
  'Authenticated users can update catalog fields subject to RLS'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.builders', 'created_by', 'insert'),
  'Browser clients cannot provide the creator audit field'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.builders', 'updated_by', 'update'),
  'Browser clients cannot provide the updater audit field'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.builders', 'delete'),
  'Builders cannot be hard deleted from the browser'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.billing_setups', 'insert'),
  'Billing setups can only be created by the internal Builder trigger'
);

select ok(
  not has_sequence_privilege('authenticated', 'valtrim.billing_setups_id_seq', 'usage'),
  'Browser clients cannot allocate Billing Setup identities'
);

select ok(
  has_sequence_privilege('authenticated', 'valtrim.builders_id_seq', 'usage'),
  'Authenticated builder inserts can allocate an identity'
);

select has_index(
  'valtrim',
  'builders',
  'builders_created_by_idx',
  'Builder creator references have a covering index'
);

select has_index(
  'valtrim',
  'builders',
  'builders_updated_by_idx',
  'Builder updater references have a covering index'
);

select has_index(
  'valtrim',
  'billing_setups',
  'billing_setups_created_by_idx',
  'Billing setup creator references have a covering index'
);

insert into valtrim.builders (code, name)
values ('PHASE1PGTAP', 'Phase One PgTap Builder');

select ok(
  exists (
    select 1
    from valtrim.billing_setups setup
    join valtrim.builders builder on builder.id = setup.builder_id
    where builder.code = 'PHASE1PGTAP'
  ),
  'Creating a builder automatically creates its billing setup'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in ('builders', 'billing_setups')
  ),
  4::bigint,
  'Builders and billing setups have the four expected RLS policies'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.jobs', 'select'),
  'Jobs remain closed after the Builders phase'
);

select * from finish();

rollback;
