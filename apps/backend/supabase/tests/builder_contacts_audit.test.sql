begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_table(
  'valtrim',
  'builder_contacts',
  'Builder contacts table is available'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.builder_contacts', 'select'),
  'Authenticated users can select contacts subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.builder_contacts', 'name', 'insert'),
  'Catalog managers can insert contact fields subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.builder_contacts', 'name', 'update'),
  'Catalog managers can update contact fields subject to RLS'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.builder_contacts', 'created_by', 'insert'),
  'Browser clients cannot forge the contact creator'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.builder_contacts', 'updated_by', 'update'),
  'Browser clients cannot forge the contact updater'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.builder_contacts', 'delete'),
  'Builder contacts cannot be hard deleted from the browser'
);

select ok(
  has_sequence_privilege('authenticated', 'valtrim.builder_contacts_id_seq', 'usage'),
  'Authorized contact inserts can allocate an identity'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'builder_contacts'
  ),
  3::bigint,
  'Builder contacts have select, insert and update RLS policies'
);

select has_function(
  'private',
  'audit_builder_contact_change',
  array[]::text[],
  'The private Builder Contact audit function exists'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'private.audit_builder_contact_change()'::regprocedure
  ),
  'The audit trigger function uses definer rights'
);

select has_trigger(
  'valtrim',
  'builder_contacts',
  'builder_contacts_audit',
  'Builder Contact changes have an audit trigger'
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

insert into valtrim.builders (code, name)
values ('CONTACTAUDIT', 'Contact Audit Builder');

insert into valtrim.builder_contacts (
  builder_id,
  name,
  type,
  email,
  phone,
  notes
)
select
  builder.id,
  'Audit Contact',
  'JOBSITE_SUPERINTENDENT',
  'audit.contact@example.com',
  '+19515550123',
  'Test-only note'
from valtrim.builders builder
where builder.code = 'CONTACTAUDIT';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_CONTACT_CREATED'
      and event.entity_label = 'Audit Contact'
  ),
  'Creating a Builder Contact records an audit event'
);

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_CONTACT_CREATED'
      and event.entity_type = 'BUILDER_CONTACT'
      and event.metadata ->> 'builderName' = 'Contact Audit Builder'
  ),
  'The created event identifies the affected contact and builder'
);

update valtrim.builder_contacts
set name = 'Updated Audit Contact'
where email = 'audit.contact@example.com';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_CONTACT_UPDATED'
      and event.previous_values ->> 'name' = 'Audit Contact'
      and event.new_values ->> 'name' = 'Updated Audit Contact'
  ),
  'Editing a Builder Contact records its previous and new values'
);

update valtrim.builder_contacts
set is_active = false
where email = 'audit.contact@example.com';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_CONTACT_DEACTIVATED'
      and event.entity_label = 'Updated Audit Contact'
  ),
  'Deactivating a Builder Contact records an audit event'
);

update valtrim.builder_contacts
set is_active = true
where email = 'audit.contact@example.com';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_CONTACT_REACTIVATED'
      and event.entity_label = 'Updated Audit Contact'
  ),
  'Reactivating a Builder Contact records an audit event'
);

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_CONTACT_CREATED'
      and event.actor_type = 'SYSTEM'
      and event.actor_name = 'System'
  ),
  'Database maintenance without a user JWT is identified as System'
);

select * from finish();

rollback;
