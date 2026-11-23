begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Block B, step B5: the other days a proposal can show the customer.
select has_column('valtrim', 'service_proposals', 'alternatives', 'Proposals store their other days');
select col_not_null('valtrim', 'service_proposals', 'alternatives', 'The other days are never null');
select col_default_is('valtrim', 'service_proposals', 'alternatives', '[]'::jsonb, 'A proposal starts with no other days');
select ok(not has_column_privilege('authenticated', 'valtrim.service_proposals', 'alternatives', 'update'),
  'Browsers cannot change the other days');

-- The check: an array of at most three entries.
create temporary table alternatives_fixture as
select id from valtrim.service_proposals order by id limit 1;
select ok((select count(*) from alternatives_fixture) = 1, 'There is a proposal to check against');
select lives_ok(
  $$update valtrim.service_proposals set alternatives = '[{"date":"2030-01-14"},{"date":"2030-01-15"},{"date":"2030-01-16"}]'
    where id = (select id from alternatives_fixture)$$,
  'Three other days are accepted');
select throws_ok(
  $$update valtrim.service_proposals set alternatives = '[{},{},{},{}]' where id = (select id from alternatives_fixture)$$,
  '23514', null, 'More than three other days are refused');
select throws_ok(
  $$update valtrim.service_proposals set alternatives = '{"date":"2030-01-14"}' where id = (select id from alternatives_fixture)$$,
  '23514', null, 'The other days must be a list');

select * from finish();
rollback;
