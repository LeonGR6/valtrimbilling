-- Plans can be put in any order within their Job. The order is stored per Plan
-- (display_order, 1-based among the Job's Plans) and changed only through
-- valtrim.reorder_job_plans, so clients cannot write it directly.

alter table valtrim.plans
  add column display_order integer not null default 0;

-- Keep today's order (creation order) for existing Plans.
update valtrim.plans plan
set display_order = ranked.position
from (
  select
    id,
    row_number() over (partition by job_id order by id) as position
  from valtrim.plans
) ranked
where ranked.id = plan.id;

-- A new Plan goes to the end of its Job's list.
create or replace function private.set_plan_display_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_order := coalesce((
    select max(plan.display_order)
    from valtrim.plans plan
    where plan.job_id = new.job_id
  ), 0) + 1;
  return new;
end;
$$;

create trigger set_plan_display_order
before insert on valtrim.plans
for each row execute function private.set_plan_display_order();

create or replace function valtrim.reorder_job_plans(
  p_job_id bigint,
  p_plan_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_active_ids bigint[];
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to reorder Plans'
      using errcode = '42501';
  end if;

  perform 1
  from valtrim.jobs job
  where job.id = p_job_id
    and job.is_active
  for update;

  if not found then
    raise exception 'Select an active Job'
      using errcode = '23503';
  end if;

  select coalesce(array_agg(plan.id order by plan.id), '{}')
  into v_active_ids
  from valtrim.plans plan
  where plan.job_id = p_job_id
    and plan.is_active;

  -- The list must be exactly the Job's active Plans, each once.
  if p_plan_ids is null
     or cardinality(p_plan_ids) <> cardinality(v_active_ids)
     or (select array_agg(id order by id) from unnest(p_plan_ids) as id)
        is distinct from v_active_ids then
    raise exception 'The Plans changed. Refresh the page and try again'
      using errcode = '23514';
  end if;

  update valtrim.plans plan
  set display_order = ordered.position
  from unnest(p_plan_ids) with ordinality as ordered(id, position)
  where plan.id = ordered.id
    and plan.display_order <> ordered.position;
end;
$$;

revoke execute on function valtrim.reorder_job_plans(bigint, bigint[])
  from public, anon, authenticated;
grant execute on function valtrim.reorder_job_plans(bigint, bigint[])
  to authenticated, service_role;

comment on function valtrim.reorder_job_plans(bigint, bigint[]) is
  'Sets the display order of a Job''s active Plans from the given list of Plan ids. ADMIN and PROJECT_MANAGEMENT only.';
