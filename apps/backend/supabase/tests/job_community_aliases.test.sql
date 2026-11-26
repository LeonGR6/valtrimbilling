begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Other names of a Job's community (26 Nov 2026): one Job per name and Builder,
-- added and removed by coordinators, audited, and read by everyone who reads Jobs.

create temporary table alias_fixture as
select gen_random_uuid() as scheduler_id, gen_random_uuid() as field_id,
  pair.builder_id, pair.job_a, pair.job_b, other.id as other_job, other.builder_id as other_builder
from (
  select job.builder_id, min(job.id) as job_a, max(job.id) as job_b
  from valtrim.jobs job
  group by job.builder_id
  having count(*) >= 2
  order by job.builder_id
  limit 1
) pair
cross join lateral (
  select job.id, job.builder_id from valtrim.jobs job where job.builder_id <> pair.builder_id order by job.id limit 1
) other;

-- A request whose import kept the combined community, read back by the RPC with the
-- Builder the import matched (the property Builder, else the document issuer).
create temporary table import_fixture as
select receipt.request_id, btrim(receipt.analysis_payload #>> '{structuredData,property,communityName}') as community,
  coalesce(nullif(btrim(receipt.analysis_payload #>> '{structuredData,property,builderName}'), ''),
    nullif(btrim(receipt.analysis_payload #>> '{structuredData,document,issuerName}'), '')) as builder
from valtrim.service_request_imports receipt
where receipt.request_id is not null
  and nullif(btrim(receipt.analysis_payload #>> '{structuredData,property,communityName}'), '') is not null
  and (select count(*) from valtrim.service_request_imports other where other.request_id = receipt.request_id) = 1
order by receipt.created_at desc
limit 1;

select ok((select count(*) from alias_fixture) = 1, 'Fixture: a Builder with two Jobs and a Job of another Builder');
select ok((select count(*) from import_fixture) = 1, 'Fixture: an imported request with its community');

select has_table('valtrim', 'job_community_aliases', 'Jobs keep other community names');
select ok(not has_column_privilege('authenticated', 'valtrim.job_community_aliases', 'created_by', 'insert'),
  'The browser cannot choose who created a name');
select ok(not has_table_privilege('authenticated', 'valtrim.job_community_aliases', 'update'),
  'Names are added or removed, never changed in place');

insert into auth.users(id, email, raw_user_meta_data)
select scheduler_id, scheduler_id::text || '@example.com', '{"name":"Alias Scheduler Test"}'::jsonb from alias_fixture
union all select field_id, field_id::text || '@example.com', '{"name":"Alias Field Test"}'::jsonb from alias_fixture;
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from alias_fixture);
update valtrim.app_users set role = 'FIELD' where id = (select field_id from alias_fixture);
grant select on alias_fixture, import_fixture to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select scheduler_id::text from alias_fixture), true);

select lives_ok($$
  insert into valtrim.job_community_aliases (job_id, builder_id, alias, alias_key)
  select job_a, builder_id, 'KB Pgtap Alias Ranch', 'kb pgtap alias ranch' from alias_fixture
$$, 'A coordinator saves a name for a Job');
select is((select created_by from valtrim.job_community_aliases where alias_key = 'kb pgtap alias ranch'),
  (select scheduler_id from alias_fixture), 'The name records who saved it');

select throws_ok($$
  insert into valtrim.job_community_aliases (job_id, builder_id, alias, alias_key)
  select job_b, builder_id, 'KB  Pgtap-Alias Ranch', 'kb pgtap alias ranch' from alias_fixture
$$, '23505', null, 'The same name cannot point to a second Job of the same Builder');

select lives_ok($$
  insert into valtrim.job_community_aliases (job_id, builder_id, alias, alias_key)
  select other_job, other_builder, 'KB Pgtap Alias Ranch', 'kb pgtap alias ranch' from alias_fixture
$$, 'Another Builder can use the same name for its own Job');

select throws_ok($$
  insert into valtrim.job_community_aliases (job_id, builder_id, alias, alias_key)
  select job_a, other_builder, 'Pgtap Wrong Builder', 'pgtap wrong builder' from alias_fixture
$$, '23503', null, 'The Builder must be the Job''s own Builder');

select throws_ok($$
  insert into valtrim.job_community_aliases (job_id, builder_id, alias, alias_key)
  select job_a, builder_id, 'Ph4', 'ph4' from alias_fixture
$$, '23514', null, 'A name shorter than four characters is rejected');

select throws_ok($$
  insert into valtrim.job_community_aliases (job_id, builder_id, alias, alias_key)
  select job_a, builder_id, 'Pgtap Bad Key', 'Pgtap-Bad  Key' from alias_fixture
$$, '23514', null, 'The comparison key must already be normalized');

select set_config('request.jwt.claim.sub', (select field_id::text from alias_fixture), true);
select ok((select count(*) from valtrim.job_community_aliases where alias_key = 'kb pgtap alias ranch') = 2,
  'A field user reads the names, like the Jobs');
select throws_ok($$
  insert into valtrim.job_community_aliases (job_id, builder_id, alias, alias_key)
  select job_b, builder_id, 'Pgtap Field Name', 'pgtap field name' from alias_fixture
$$, '42501', null, 'A field user cannot save a name');
delete from valtrim.job_community_aliases where alias_key = 'kb pgtap alias ranch';
select ok((select count(*) from valtrim.job_community_aliases where alias_key = 'kb pgtap alias ranch') = 2,
  'A field user cannot remove a name');
select is(valtrim.read_customer_service_import_property((select request_id from import_fixture)), null,
  'A field user does not read the imported community');

select set_config('request.jwt.claim.sub', (select scheduler_id::text from alias_fixture), true);
select is(valtrim.read_customer_service_import_property((select request_id from import_fixture)) ->> 'communityName',
  (select community from import_fixture), 'A coordinator reads the community the import combined');
select is(valtrim.read_customer_service_import_property((select request_id from import_fixture)) ->> 'builderName',
  (select builder from import_fixture), 'and the Builder the source named, to offer the name only for that Builder');
select ok(not exists (
  select 1 from pg_proc where proname = 'read_customer_service_import_community'
), 'The community-only read is gone');
delete from valtrim.job_community_aliases
where alias_key = 'kb pgtap alias ranch' and builder_id = (select builder_id from alias_fixture);
select ok((select count(*) from valtrim.job_community_aliases where alias_key = 'kb pgtap alias ranch') = 1,
  'A coordinator removes a wrong name');

reset role;
select set_config('request.jwt.claim.sub', '', true);

select is((
  select count(*) from valtrim.audit_events event
  where event.action = 'JOB_COMMUNITY_ALIAS_ADDED' and event.new_values ->> 'alias' = 'KB Pgtap Alias Ranch'
    and event.actor_user_id = (select scheduler_id from alias_fixture)
), 2::bigint, 'Each saved name is audited with who saved it');
select is((
  select count(*) from valtrim.audit_events event
  where event.action = 'JOB_COMMUNITY_ALIAS_REMOVED' and event.previous_values ->> 'alias' = 'KB Pgtap Alias Ranch'
    and event.entity_id = (select job_a::text from alias_fixture)
), 1::bigint, 'Each removed name is audited');

select * from finish();
rollback;
