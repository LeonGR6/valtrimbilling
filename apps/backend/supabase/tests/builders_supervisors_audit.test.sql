begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_function(
  'private',
  'audit_builder_change',
  array[]::text[],
  'The private Builder audit function exists'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid = 'private.audit_builder_change()'::regprocedure
  ),
  'The Builder audit function uses definer rights'
);

select has_trigger(
  'valtrim',
  'builders',
  'builders_audit',
  'Builder changes have an audit trigger'
);

select has_function(
  'private',
  'audit_supervisor_created',
  array[]::text[],
  'The private Supervisor creation audit function exists'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid = 'private.audit_supervisor_created()'::regprocedure
  ),
  'The Supervisor creation audit function uses definer rights'
);

select has_trigger(
  'valtrim',
  'person_roles',
  'supervisor_roles_audit',
  'Assigning the Supervisor role has an audit trigger'
);

select has_function(
  'private',
  'audit_supervisor_change',
  array[]::text[],
  'The private Supervisor update audit function exists'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid = 'private.audit_supervisor_change()'::regprocedure
  ),
  'The Supervisor update audit function uses definer rights'
);

select has_trigger(
  'valtrim',
  'people',
  'supervisors_audit',
  'Supervisor changes have an audit trigger'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.audit_builder_change()',
    'execute'
  ),
  'Browser clients cannot invoke the Builder audit function'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.audit_supervisor_created()',
    'execute'
  ),
  'Browser clients cannot invoke the Supervisor creation audit function'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.audit_supervisor_change()',
    'execute'
  ),
  'Browser clients cannot invoke the Supervisor update audit function'
);

insert into valtrim.builders (code, name, contact_email)
values ('AUDITBUILDER', 'Audit Builder', 'builder.audit@example.com');

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_CREATED'
      and event.entity_type = 'BUILDER'
      and event.entity_label = 'Audit Builder'
  ),
  'Creating a Builder records an audit event'
);

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_CREATED'
      and event.metadata ->> 'builderCode' = 'AUDITBUILDER'
      and event.new_values ->> 'contact_email' = 'builder.audit@example.com'
  ),
  'The Builder creation event includes its code and catalog values'
);

update valtrim.builders
set name = name
where code = 'AUDITBUILDER';

select is(
  (
    select count(*)
    from valtrim.audit_events event
    where event.action = 'BUILDER_UPDATED'
      and event.metadata ->> 'builderCode' = 'AUDITBUILDER'
  ),
  0::bigint,
  'Saving an unchanged Builder does not create an audit event'
);

update valtrim.builders
set name = 'Updated Audit Builder'
where code = 'AUDITBUILDER';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_UPDATED'
      and event.previous_values ->> 'name' = 'Audit Builder'
      and event.new_values ->> 'name' = 'Updated Audit Builder'
  ),
  'Editing a Builder records its previous and new values'
);

update valtrim.builders
set is_active = false
where code = 'AUDITBUILDER';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_DEACTIVATED'
      and event.metadata ->> 'builderCode' = 'AUDITBUILDER'
  ),
  'Deactivating a Builder records an audit event'
);

update valtrim.builders
set is_active = true
where code = 'AUDITBUILDER';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'BUILDER_REACTIVATED'
      and event.metadata ->> 'builderCode' = 'AUDITBUILDER'
  ),
  'Reactivating a Builder records an audit event'
);

insert into valtrim.people (
  name,
  email,
  phone,
  territory
)
values (
  'Audit Supervisor',
  'supervisor.audit@example.com',
  '+19515550124',
  'Audit Territory'
);

insert into valtrim.person_roles (person_id, role)
select person.id, 'SUPERVISOR'
from valtrim.people person
where person.email = 'supervisor.audit@example.com';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'SUPERVISOR_CREATED'
      and event.entity_type = 'SUPERVISOR'
      and event.entity_label = 'Audit Supervisor'
  ),
  'Creating a Supervisor records an audit event after its role is assigned'
);

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'SUPERVISOR_CREATED'
      and event.metadata ->> 'supervisorEmail' = 'supervisor.audit@example.com'
      and event.metadata ->> 'territory' = 'Audit Territory'
  ),
  'The Supervisor creation event includes its email and territory'
);

update valtrim.people
set territory = territory
where email = 'supervisor.audit@example.com';

select is(
  (
    select count(*)
    from valtrim.audit_events event
    where event.action = 'SUPERVISOR_UPDATED'
      and event.metadata ->> 'supervisorEmail' = 'supervisor.audit@example.com'
  ),
  0::bigint,
  'Saving an unchanged Supervisor does not create an audit event'
);

update valtrim.people
set territory = 'Updated Audit Territory'
where email = 'supervisor.audit@example.com';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'SUPERVISOR_UPDATED'
      and event.previous_values ->> 'territory' = 'Audit Territory'
      and event.new_values ->> 'territory' = 'Updated Audit Territory'
  ),
  'Editing a Supervisor records its previous and new values'
);

update valtrim.people
set is_active = false
where email = 'supervisor.audit@example.com';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'SUPERVISOR_DEACTIVATED'
      and event.metadata ->> 'supervisorEmail' = 'supervisor.audit@example.com'
  ),
  'Deactivating a Supervisor records an audit event'
);

update valtrim.people
set is_active = true
where email = 'supervisor.audit@example.com';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action = 'SUPERVISOR_REACTIVATED'
      and event.metadata ->> 'supervisorEmail' = 'supervisor.audit@example.com'
  ),
  'Reactivating a Supervisor records an audit event'
);

insert into valtrim.people (name, email)
values ('Audit Foreman', 'foreman.audit@example.com');

insert into valtrim.person_roles (person_id, role)
select person.id, 'FOREMAN'
from valtrim.people person
where person.email = 'foreman.audit@example.com';

update valtrim.people
set name = 'Updated Audit Foreman'
where email = 'foreman.audit@example.com';

select ok(
  not exists (
    select 1
    from valtrim.audit_events event
    where event.module = 'PEOPLE'
      and event.entity_label in ('Audit Foreman', 'Updated Audit Foreman')
  ),
  'People without the Supervisor role do not produce Supervisor events'
);

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    where event.action in ('BUILDER_CREATED', 'SUPERVISOR_CREATED')
      and event.actor_type = 'SYSTEM'
      and event.actor_name = 'System'
  ),
  'Database maintenance without a user JWT is identified as System'
);

select * from finish();

rollback;
