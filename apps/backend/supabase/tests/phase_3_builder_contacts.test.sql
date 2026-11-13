begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('valtrim', 'builder_contacts', 'Builder Contacts table is available');

select ok(
  has_table_privilege('authenticated', 'valtrim.builder_contacts', 'select'),
  'Authenticated users can select Builder Contacts subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.builder_contacts', 'name', 'insert'),
  'Authenticated users can insert contact fields subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.builder_contacts', 'name', 'update'),
  'Authenticated users can update contact fields subject to RLS'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.builder_contacts',
    'created_by',
    'insert'
  ),
  'Browser clients cannot provide the creator audit field'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.builder_contacts',
    'updated_by',
    'update'
  ),
  'Browser clients cannot provide the updater audit field'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.builder_contacts', 'delete'),
  'Builder Contacts cannot be hard deleted from the browser'
);

select ok(
  has_sequence_privilege(
    'authenticated',
    'valtrim.builder_contacts_id_seq',
    'usage'
  ),
  'Authenticated contact inserts can allocate an identity'
);

select ok(
  enum_range(null::valtrim.contact_type)::text[] =
    array['JOBSITE_SUPERINTENDENT', 'AP_CONTACT']::text[],
  'Builder Contacts support exactly the two required contact types'
);

select has_index(
  'valtrim',
  'builder_contacts',
  'builder_contacts_builder_idx',
  'Builder, contact type, and active state have a composite index'
);

select has_index(
  'valtrim',
  'builder_contacts',
  'builder_contacts_created_by_idx',
  'Builder Contact creator references have a covering index'
);

select has_index(
  'valtrim',
  'builder_contacts',
  'builder_contacts_updated_by_idx',
  'Builder Contact updater references have a covering index'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'builder_contacts'
  ),
  3::bigint,
  'Builder Contacts have select, insert, and update RLS policies'
);

insert into valtrim.builders (code, name)
values ('PHASE3PGTAP', 'Phase Three PgTap Builder');

insert into valtrim.builder_contacts (
  builder_id,
  name,
  type,
  email
)
select id, 'Phase Three Superintendent', 'JOBSITE_SUPERINTENDENT',
  'phase3-superintendent@example.com'
from valtrim.builders
where code = 'PHASE3PGTAP';

insert into valtrim.builder_contacts (
  builder_id,
  name,
  type,
  email
)
select id, 'Phase Three AP Contact', 'AP_CONTACT',
  'phase3-ap@example.com'
from valtrim.builders
where code = 'PHASE3PGTAP';

select is(
  (
    select count(*)
    from valtrim.builder_contacts contact
    join valtrim.builders builder on builder.id = contact.builder_id
    where builder.code = 'PHASE3PGTAP'
  ),
  2::bigint,
  'Both contact types can coexist for one persisted Builder'
);

select ok(
  exists (
    select 1
    from valtrim.builder_contacts
    where email = 'phase3-superintendent@example.com'
      and type = 'JOBSITE_SUPERINTENDENT'
  ),
  'Jobsite Superintendent is stored with its exact type'
);

select ok(
  exists (
    select 1
    from valtrim.builder_contacts
    where email = 'phase3-ap@example.com'
      and type = 'AP_CONTACT'
  ),
  'AP Contact is stored with its exact type'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.communities', 'select'),
  'Communities remain closed after the Builder Contacts phase'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.plans', 'select'),
  'Unopened Plans remain closed after the Builder Contacts phase'
);

select * from finish();

rollback;
