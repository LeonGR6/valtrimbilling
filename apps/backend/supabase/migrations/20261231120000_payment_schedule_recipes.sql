-- Phase 110: remembered Payment Schedule layouts ("recipes").
--
-- A layout no parser knows is read with AI once. When the reviewer confirms it and
-- asks to remember it, the payment-schedule-analyze Edge Function learns from the
-- PDF and the confirmed cells how that builder's layout is read (which text names
-- each draw and the Utility, which label precedes the Lot) and stores it here.
-- The next schedules of that builder are read with the recipe: no AI, nothing sent
-- out of the project. A recipe is only stored when it reproduces the confirmed
-- cells exactly.
--
-- Rules shape (version 1, kind line_code), written by the Edge Function only:
--   { "version": 1, "kind": "line_code",
--     "signature": ["Project Purchase Order Report", ...],   -- text the layout prints
--     "lotLabel": "Lot:",                                    -- the Lot is the next piece
--     "draws": [ { "draw": 1, "key": "40-240-10" }, ... ],   -- text on the draw's line
--     "utility": { "key": "40-240-50" } | null }
-- No amount, Lot or other content of the document is kept.
--
-- Writes: the Edge Function as service_role; forgetting one goes through a
-- role-checked RPC. Reads: the roles that analyze Payment Schedules.

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

notify pgrst, 'reload schema';

commit;
