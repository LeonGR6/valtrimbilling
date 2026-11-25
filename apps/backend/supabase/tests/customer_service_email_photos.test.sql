begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Email photos as reduced WebP copies (25 Nov 2026).

select is((select public from storage.buckets where id = 'customer-service-photos'), false, 'The photo bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'customer-service-photos'), array['image/webp']::text[],
  'The photo bucket only takes WebP copies');
select is((select file_size_limit from storage.buckets where id = 'customer-service-photos'), 2000000::bigint,
  'A copy cannot exceed 2 MB');

select ok(not has_table_privilege('authenticated', 'valtrim.service_request_photos', 'insert'), 'The browser cannot add photos');
select ok(not has_table_privilege('authenticated', 'valtrim.service_request_photos', 'update'), 'The browser cannot change photos');
select ok(has_function_privilege('service_role', 'valtrim.read_customer_service_photo_source(uuid)', 'execute'),
  'The photo function reads the Outlook origin');
select ok(not has_function_privilege('authenticated', 'valtrim.read_customer_service_photo_source(uuid)', 'execute'),
  'Signed-in users cannot read the Outlook origin');
select is(valtrim.read_customer_service_photo_source(gen_random_uuid()) ->> 'connectionAvailable', 'false',
  'An unknown import has no origin');
select is((select schedule from cron.job where jobname = 'customer-service-email-photos'), '* * * * *',
  'The photo function runs every minute');

-- A stored photo of a processed email is visible to Customer Service staff only.
create temporary table photo_fixture as
select imp.id as import_id, imp.request_id, gen_random_uuid() as scheduler_id, gen_random_uuid() as field_id
from valtrim.service_request_imports imp
where imp.request_id is not null
order by imp.created_at
limit 1;
insert into valtrim.service_request_photos (import_id, attachment_id, request_id, original_filename, original_mime_type,
  original_size_bytes, original_sha256, status, object_path, width, height, size_bytes, stored_at)
select import_id, 'photo-test-attachment', request_id, 'IMG_0001.jpg', 'image/jpeg', 3000000, repeat('a', 64),
  'STORED', request_id || '/test.webp', 1600, 1200, 200000, now()
from photo_fixture;
select throws_ok(
  $$insert into valtrim.service_request_photos (import_id, attachment_id, request_id, original_filename, original_mime_type,
      original_size_bytes, original_sha256, status)
    select import_id, 'photo-test-stored-without-file', request_id, 'IMG_0002.jpg', 'image/jpeg', 3000000, repeat('b', 64), 'STORED'
    from photo_fixture$$,
  '23514', null, 'A stored photo needs its file, size and dimensions');

insert into auth.users(id, email, raw_user_meta_data)
select scheduler_id, scheduler_id::text || '@example.com', '{"name":"Photo Scheduler Test"}'::jsonb from photo_fixture
union all select field_id, field_id::text || '@example.com', '{"name":"Photo Field Test"}'::jsonb from photo_fixture;
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from photo_fixture);
update valtrim.app_users set role = 'FIELD' where id = (select field_id from photo_fixture);
grant select on photo_fixture to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select scheduler_id::text from photo_fixture), true);
select is((select count(*) from valtrim.service_request_photos where attachment_id = 'photo-test-attachment'), 1::bigint,
  'A scheduler sees the photos');
select set_config('request.jwt.claim.sub', (select field_id::text from photo_fixture), true);
select is((select count(*) from valtrim.service_request_photos where attachment_id = 'photo-test-attachment'), 0::bigint,
  'A field user does not');
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
