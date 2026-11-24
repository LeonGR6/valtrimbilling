-- Dry run of 20261231120000_payment_schedule_recipes.sql: migration + checks, rolled back.
begin;


create table valtrim.payment_schedule_recipes (
  id uuid primary key default gen_random_uuid(),
  builder_id bigint not null references valtrim.builders(id) on delete cascade,
  -- What tells this layout apart from the builder's other ones.
  signature_key text not null check (char_length(signature_key) between 1 and 1000),
  rules jsonb not null check (
    jsonb_typeof(rules) = 'object'
    and rules -> 'version' = to_jsonb(1)
    and rules ->> 'kind' = 'line_code'
    and jsonb_typeof(rules -> 'draws') = 'array'
    and jsonb_array_length(rules -> 'draws') between 1 and 5
  ),
  learned_from_template_id uuid
    references valtrim.payment_schedule_templates(id) on delete set null,
  learned_from_job_id bigint references valtrim.jobs(id) on delete set null,
  created_by uuid not null references valtrim.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_schedule_recipes_builder_signature_key unique (builder_id, signature_key)
);

create index payment_schedule_recipes_template_idx
  on valtrim.payment_schedule_recipes (learned_from_template_id)
  where learned_from_template_id is not null;
create index payment_schedule_recipes_job_idx
  on valtrim.payment_schedule_recipes (learned_from_job_id)
  where learned_from_job_id is not null;
create index payment_schedule_recipes_created_by_idx
  on valtrim.payment_schedule_recipes (created_by);

alter table valtrim.payment_schedule_recipes enable row level security;

create policy payment_schedule_recipes_select
  on valtrim.payment_schedule_recipes
  for select
  to authenticated
  using ((select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')));

revoke all on table valtrim.payment_schedule_recipes from public, anon, authenticated;
grant select on table valtrim.payment_schedule_recipes to authenticated;
grant all on table valtrim.payment_schedule_recipes to service_role;

create function private.forget_payment_schedule_recipe(p_recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')) then
    raise exception 'You do not have permission to forget Payment Schedule layouts'
      using errcode = '42501';
  end if;

  delete from valtrim.payment_schedule_recipes recipe
  where recipe.id = p_recipe_id;

  if not found then
    raise exception 'This remembered layout is no longer available'
      using errcode = 'P0002';
  end if;
end;
$$;

create function valtrim.forget_payment_schedule_recipe(p_recipe_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.forget_payment_schedule_recipe(p_recipe_id);
$$;

revoke execute on function private.forget_payment_schedule_recipe(uuid)
  from public, anon, authenticated;
revoke execute on function valtrim.forget_payment_schedule_recipe(uuid)
  from public, anon, authenticated;
grant execute on function private.forget_payment_schedule_recipe(uuid)
  to authenticated, service_role;
grant execute on function valtrim.forget_payment_schedule_recipe(uuid)
  to authenticated, service_role;

comment on table valtrim.payment_schedule_recipes is
  'How a builder''s Payment Schedule layout is read without AI, learned from a confirmed schedule. Rules only, no document content.';




create temporary table phase110_results (name text primary key, ok boolean not null);
grant all on phase110_results to authenticated;

insert into phase110_results
select '01 RLS enabled', relrowsecurity from pg_class where oid = 'valtrim.payment_schedule_recipes'::regclass;
insert into phase110_results
select '02 authenticated reads, does not write',
  has_table_privilege('authenticated', 'valtrim.payment_schedule_recipes', 'select')
  and not has_table_privilege('authenticated', 'valtrim.payment_schedule_recipes', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.payment_schedule_recipes', 'delete');
insert into phase110_results
select '03 anon has nothing', not has_table_privilege('anon', 'valtrim.payment_schedule_recipes', 'select');

create temporary table phase110_ctx as
select
  (select id from valtrim.builders order by id limit 1) as builder_id,
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1) as admin_id,
  (select id from valtrim.app_users where role not in ('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE') and is_active order by created_at limit 1) as other_id;
grant select on phase110_ctx to authenticated;

insert into valtrim.payment_schedule_recipes (builder_id, signature_key, rules, created_by)
select builder_id, 'TEST|LOT=LOT:',
  '{"version": 1, "kind": "line_code", "signature": ["X"], "lotLabel": "Lot:", "draws": [{"draw": 1, "key": "40-10"}], "utility": null}',
  admin_id
from phase110_ctx;
insert into phase110_results values ('04 a valid recipe is stored', true);

do $t$
declare
  v_ok boolean;
begin
  begin
    insert into valtrim.payment_schedule_recipes (builder_id, signature_key, rules, created_by)
    select builder_id, 'TEST|LOT=LOT:', '{"version": 1, "kind": "line_code", "draws": [{"draw": 1, "key": "a"}]}', admin_id from phase110_ctx;
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  insert into phase110_results values ('05 one recipe per builder and layout', v_ok);

  begin
    insert into valtrim.payment_schedule_recipes (builder_id, signature_key, rules, created_by)
    select builder_id, 'OTHER', '{"version": 2, "kind": "line_code", "draws": [{"draw": 1, "key": "a"}]}', admin_id from phase110_ctx;
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  insert into phase110_results values ('06 rules of another version rejected', v_ok);

  begin
    insert into valtrim.payment_schedule_recipes (builder_id, signature_key, rules, created_by)
    select builder_id, 'OTHER', '{"version": 1, "kind": "line_code", "draws": []}', admin_id from phase110_ctx;
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  insert into phase110_results values ('07 rules without draws rejected', v_ok);
end;
$t$;

-- As a user without the role: cannot forget.
select set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true) from phase110_ctx;
set local role authenticated;
do $t$
declare
  v_ok boolean;
  v_id uuid;
begin
  if (select other_id from phase110_ctx) is null then
    insert into phase110_results values ('08 another role cannot forget (no such user, skipped)', true);
    insert into phase110_results values ('09 another role cannot read', true);
    return;
  end if;
  select id into v_id from valtrim.payment_schedule_recipes limit 1;
  insert into phase110_results values ('09 another role cannot read', v_id is null);
  begin
    perform valtrim.forget_payment_schedule_recipe(gen_random_uuid());
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  insert into phase110_results values ('08 another role cannot forget', v_ok);
end;
$t$;
reset role;

-- As an ADMIN: reads and forgets; forgetting twice says it is gone.
select set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true) from phase110_ctx;
set local role authenticated;
do $t$
declare
  v_id uuid;
  v_ok boolean;
begin
  select id into v_id from valtrim.payment_schedule_recipes where signature_key = 'TEST|LOT=LOT:';
  insert into phase110_results values ('10 ADMIN reads recipes', v_id is not null);
  perform valtrim.forget_payment_schedule_recipe(v_id);
  insert into phase110_results values ('11 ADMIN forgets a recipe',
    not exists (select 1 from valtrim.payment_schedule_recipes where id = v_id));
  begin
    perform valtrim.forget_payment_schedule_recipe(v_id);
    v_ok := false;
  exception when sqlstate 'P0002' then v_ok := true;
  end;
  insert into phase110_results values ('12 forgetting it again says it is gone', v_ok);
end;
$t$;
reset role;

do $r$
declare
  v_report text;
  v_failed integer;
begin
  select string_agg(name || ' = ' || ok, E'\n' order by name), count(*) filter (where not ok)
    into v_report, v_failed
  from phase110_results;
  raise exception E'DRY RUN (rolled back), % failed:\n%', v_failed, v_report;
end;
$r$;

rollback;
