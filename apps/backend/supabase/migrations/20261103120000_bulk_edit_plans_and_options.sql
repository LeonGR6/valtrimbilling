-- Editing the Plans and Options of a Job in bulk.
--
-- The Plans & Options page has a Bulk edit mode: a grid with the Job's Plans and Options, where the
-- person adds, edits and deletes many at once and saves everything together.
-- valtrim.apply_plan_option_changes does that save in one transaction, so a failure leaves nothing
-- half done. It takes a list of changes:
--
--   new_plans        Plans to create, each with its Options. A Plan that was deleted (inactive) with
--                    the same code is brought back, as the single "Add plan" does.
--   option_adds      Options to add to Plans that exist, by Plan id.
--   plan_updates     a Plan's new code and name.
--   option_updates   an Option's new OPT # and description.
--   deleted_plans    Plans to delete, with their Options.
--   deleted_options  Options to delete.
--
-- It follows the rules of the single changes: a Plan or an Option that a Lot uses cannot be deleted,
-- a Plan code is not repeated in the Job, an Option the Plan already has (same OPT # and description)
-- is skipped when added, and deleting means deactivating, so nothing is lost. Changing a Plan's code
-- does not touch its Lots, which point to the Plan, not to its code.
--
-- For Admin and Project Management, like the rest of the Plan and Option changes.

begin;

create or replace function valtrim.apply_plan_option_changes(
  p_job_id bigint,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_changes constant integer := 3000;
  v_actor_id uuid := (select auth.uid());
  v_new_plans jsonb;
  v_option_adds jsonb;
  v_plan_updates jsonb;
  v_option_updates jsonb;
  v_deleted_plans jsonb;
  v_deleted_options jsonb;
  v_item jsonb;
  v_option jsonb;
  v_id bigint;
  v_plan_id bigint;
  v_code text;
  v_name text;
  v_option_code text;
  v_description text;
  v_plan_found record;
  v_row record;
  v_plan_created boolean;
  v_plans_created integer := 0;
  v_plans_restored integer := 0;
  v_plans_updated integer := 0;
  v_plans_deleted integer := 0;
  v_options_created integer := 0;
  v_options_skipped integer := 0;
  v_options_updated integer := 0;
  v_options_deleted integer := 0;
  v_plan_list jsonb := '[]'::jsonb;
  v_touched_plans bigint[] := '{}';
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Plans or Options'
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

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Nothing to change'
      using errcode = '23514';
  end if;

  v_new_plans := coalesce(p_changes -> 'new_plans', '[]'::jsonb);
  v_option_adds := coalesce(p_changes -> 'option_adds', '[]'::jsonb);
  v_plan_updates := coalesce(p_changes -> 'plan_updates', '[]'::jsonb);
  v_option_updates := coalesce(p_changes -> 'option_updates', '[]'::jsonb);
  v_deleted_plans := coalesce(p_changes -> 'deleted_plans', '[]'::jsonb);
  v_deleted_options := coalesce(p_changes -> 'deleted_options', '[]'::jsonb);

  if jsonb_typeof(v_new_plans) <> 'array'
     or jsonb_typeof(v_option_adds) <> 'array'
     or jsonb_typeof(v_plan_updates) <> 'array'
     or jsonb_typeof(v_option_updates) <> 'array'
     or jsonb_typeof(v_deleted_plans) <> 'array'
     or jsonb_typeof(v_deleted_options) <> 'array' then
    raise exception 'The changes are not in the expected format'
      using errcode = '23514';
  end if;

  if jsonb_array_length(v_new_plans) + jsonb_array_length(v_option_adds)
     + jsonb_array_length(v_plan_updates) + jsonb_array_length(v_option_updates)
     + jsonb_array_length(v_deleted_plans) + jsonb_array_length(v_deleted_options) = 0 then
    raise exception 'Nothing to change'
      using errcode = '23514';
  end if;

  if jsonb_array_length(v_new_plans) + jsonb_array_length(v_option_adds)
     + jsonb_array_length(v_plan_updates) + jsonb_array_length(v_option_updates)
     + jsonb_array_length(v_deleted_plans) + jsonb_array_length(v_deleted_options)
     + (
       select coalesce(sum(
         case when jsonb_typeof(plan -> 'options') = 'array'
           then jsonb_array_length(plan -> 'options')
           else 0
         end
       ), 0)
       from jsonb_array_elements(v_new_plans) as plan
       where jsonb_typeof(plan) = 'object'
     ) > c_max_changes then
    raise exception 'Change at most % Plans and Options at a time', c_max_changes
      using errcode = '23514';
  end if;

  -- Deletions first ------------------------------------------------------------------------------

  for v_id in select value::bigint from jsonb_array_elements_text(v_deleted_plans)
  loop
    select plan.code
    into v_plan_found
    from valtrim.plans plan
    where plan.id = v_id
      and plan.job_id = p_job_id
      and plan.is_active
    for update of plan;

    if not found then
      raise exception 'A Plan to delete is no longer in the Job. Refresh the page and try again'
        using errcode = '23503';
    end if;

    if exists (select 1 from valtrim.lots lot where lot.plan_id = v_id)
       or exists (select 1 from valtrim.lot_options selected where selected.plan_id = v_id) then
      raise exception 'Plan % is used by Lots. Reassign or remove them first', v_plan_found.code
        using errcode = '23503';
    end if;

    update valtrim.plan_options
    set is_active = false
    where plan_id = v_id
      and is_active;

    update valtrim.plans
    set is_active = false
    where id = v_id;

    v_plans_deleted := v_plans_deleted + 1;
  end loop;

  for v_id in select value::bigint from jsonb_array_elements_text(v_deleted_options)
  loop
    select option.code, option.plan_id
    into v_row
    from valtrim.plan_options option
    join valtrim.plans plan on plan.id = option.plan_id
    where option.id = v_id
      and option.is_active
      and plan.job_id = p_job_id
      and plan.is_active
    for update of option;

    if not found then
      raise exception 'An Option to delete is no longer in the Job. Refresh the page and try again'
        using errcode = '23503';
    end if;

    if exists (select 1 from valtrim.lot_options selected where selected.option_id = v_id) then
      raise exception 'Option % is assigned to Lots. Remove it from them first', v_row.code
        using errcode = '23503';
    end if;

    update valtrim.plan_options
    set is_active = false
    where id = v_id;

    v_options_deleted := v_options_deleted + 1;
  end loop;

  -- Plan codes and names ---------------------------------------------------------------------------
  -- Codes are moved aside first, so two Plans can swap codes in one save.

  for v_item in select value from jsonb_array_elements(v_plan_updates)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each Plan change needs a Plan'
        using errcode = '23514';
    end if;

    v_id := (v_item ->> 'id')::bigint;
    v_code := upper(btrim(coalesce(v_item ->> 'code', '')));
    v_name := btrim(coalesce(v_item ->> 'name', ''));

    if v_code = '' or char_length(v_code) > 40 then
      raise exception 'Each Plan needs a code of 40 characters or fewer'
        using errcode = '23514';
    end if;

    if char_length(v_name) > 100 then
      raise exception 'Plan % has a name over 100 characters', v_code
        using errcode = '23514';
    end if;

    perform 1
    from valtrim.plans plan
    where plan.id = v_id
      and plan.job_id = p_job_id
      and plan.is_active
    for update;

    if not found then
      raise exception 'Plan % is no longer in the Job. Refresh the page and try again', v_code
        using errcode = '23503';
    end if;

    update valtrim.plans
    set code = '~' || id::text
    where id = v_id
      and code <> v_code;
  end loop;

  for v_item in select value from jsonb_array_elements(v_plan_updates)
  loop
    v_id := (v_item ->> 'id')::bigint;
    v_code := upper(btrim(v_item ->> 'code'));
    v_name := btrim(coalesce(v_item ->> 'name', ''));

    begin
      update valtrim.plans
      set code = v_code,
          name = coalesce(nullif(v_name, ''), v_code),
          description = null
      where id = v_id;
    exception
      when unique_violation then
        raise exception 'Plan code % already exists in this Job (it may be a deleted Plan)', v_code
          using errcode = '23505';
    end;

    v_plans_updated := v_plans_updated + 1;
  end loop;

  -- Option codes and descriptions ----------------------------------------------------------------

  for v_item in select value from jsonb_array_elements(v_option_updates)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each Option change needs an Option'
        using errcode = '23514';
    end if;

    v_id := (v_item ->> 'id')::bigint;
    v_option_code := upper(btrim(coalesce(v_item ->> 'code', '')));
    v_description := btrim(coalesce(v_item ->> 'description', ''));

    if v_option_code = '' or char_length(v_option_code) > 40 then
      raise exception 'Each Option needs an OPT # of 40 characters or fewer'
        using errcode = '23514';
    end if;

    if v_description = '' or char_length(v_description) > 240 then
      raise exception 'Option % needs a description (240 characters or fewer)', v_option_code
        using errcode = '23514';
    end if;

    perform 1
    from valtrim.plan_options option
    join valtrim.plans plan on plan.id = option.plan_id
    where option.id = v_id
      and option.is_active
      and plan.job_id = p_job_id
      and plan.is_active
    for update of option;

    if not found then
      raise exception 'Option % is no longer in the Job. Refresh the page and try again', v_option_code
        using errcode = '23503';
    end if;

    update valtrim.plan_options
    set code = v_option_code,
        name = v_description,
        description = v_description
    where id = v_id;

    v_options_updated := v_options_updated + 1;
  end loop;

  -- New Plans, each with its Options ---------------------------------------------------------------

  for v_item in select value from jsonb_array_elements(v_new_plans)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each Plan must have a code'
        using errcode = '23514';
    end if;

    v_code := upper(btrim(coalesce(v_item ->> 'code', '')));
    v_name := btrim(coalesce(v_item ->> 'name', ''));

    if v_code = '' or char_length(v_code) > 40 then
      raise exception 'Each Plan needs a code of 40 characters or fewer'
        using errcode = '23514';
    end if;

    if char_length(v_name) > 100 then
      raise exception 'Plan % has a name over 100 characters', v_code
        using errcode = '23514';
    end if;

    select plan.id, plan.is_active
    into v_plan_found
    from valtrim.plans plan
    where plan.job_id = p_job_id
      and upper(btrim(plan.code)) = v_code
    order by (plan.code = v_code) desc, plan.id
    limit 1;

    v_plan_created := false;

    if not found then
      insert into valtrim.plans (job_id, code, name, description)
      values (p_job_id, v_code, coalesce(nullif(v_name, ''), v_code), null)
      returning id into v_plan_id;

      v_plans_created := v_plans_created + 1;
      v_plan_created := true;
    else
      v_plan_id := v_plan_found.id;

      if not v_plan_found.is_active then
        update valtrim.plans
        set is_active = true,
            name = coalesce(nullif(v_name, ''), v_code),
            description = null
        where id = v_plan_id;

        v_plans_restored := v_plans_restored + 1;
      end if;
    end if;

    v_plan_list := v_plan_list || jsonb_build_array(jsonb_build_object(
      'id', v_plan_id,
      'code', v_code,
      'created', v_plan_created
    ));

    if jsonb_typeof(v_item -> 'options') = 'array' then
      for v_option in select value from jsonb_array_elements(v_item -> 'options')
      loop
        if jsonb_typeof(v_option) <> 'object' then
          raise exception 'Each Option needs an OPT # and a description'
            using errcode = '23514';
        end if;

        v_option_code := upper(btrim(coalesce(v_option ->> 'code', '')));
        v_description := btrim(coalesce(v_option ->> 'description', ''));

        if v_option_code = '' or char_length(v_option_code) > 40 then
          raise exception 'Each Option of Plan % needs an OPT # (40 characters or fewer)', v_code
            using errcode = '23514';
        end if;

        if v_description = '' or char_length(v_description) > 240 then
          raise exception 'Option % of Plan % needs a description (240 characters or fewer)',
            v_option_code, v_code
            using errcode = '23514';
        end if;

        if exists (
          select 1
          from valtrim.plan_options existing
          where existing.plan_id = v_plan_id
            and existing.is_active
            and upper(btrim(existing.code)) = v_option_code
            and lower(btrim(coalesce(existing.description, existing.name)))
              = lower(v_description)
        ) then
          v_options_skipped := v_options_skipped + 1;
        else
          insert into valtrim.plan_options (plan_id, code, name, description)
          values (v_plan_id, v_option_code, v_description, v_description);

          v_options_created := v_options_created + 1;
        end if;
      end loop;
    end if;
  end loop;

  -- New Options for Plans that exist ---------------------------------------------------------------

  for v_item in select value from jsonb_array_elements(v_option_adds)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each new Option needs a Plan'
        using errcode = '23514';
    end if;

    v_plan_id := (v_item ->> 'plan_id')::bigint;
    v_option_code := upper(btrim(coalesce(v_item ->> 'code', '')));
    v_description := btrim(coalesce(v_item ->> 'description', ''));

    select plan.code
    into v_plan_found
    from valtrim.plans plan
    where plan.id = v_plan_id
      and plan.job_id = p_job_id
      and plan.is_active;

    if not found then
      raise exception 'A Plan for a new Option is no longer in the Job. Refresh the page and try again'
        using errcode = '23503';
    end if;

    if v_option_code = '' or char_length(v_option_code) > 40 then
      raise exception 'Each Option of Plan % needs an OPT # (40 characters or fewer)', v_plan_found.code
        using errcode = '23514';
    end if;

    if v_description = '' or char_length(v_description) > 240 then
      raise exception 'Option % of Plan % needs a description (240 characters or fewer)',
        v_option_code, v_plan_found.code
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from valtrim.plan_options existing
      where existing.plan_id = v_plan_id
        and existing.is_active
        and upper(btrim(existing.code)) = v_option_code
        and lower(btrim(coalesce(existing.description, existing.name)))
          = lower(v_description)
    ) then
      v_options_skipped := v_options_skipped + 1;
    else
      insert into valtrim.plan_options (plan_id, code, name, description)
      values (v_plan_id, v_option_code, v_description, v_description);

      v_options_created := v_options_created + 1;
      if not (v_plan_id = any (v_touched_plans)) then
        v_touched_plans := v_touched_plans || v_plan_id;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'plans_created', v_plans_created,
    'plans_restored', v_plans_restored,
    'plans_updated', v_plans_updated,
    'plans_deleted', v_plans_deleted,
    'options_created', v_options_created,
    'options_skipped', v_options_skipped,
    'options_updated', v_options_updated,
    'options_deleted', v_options_deleted,
    'plans', v_plan_list,
    'option_plan_ids', to_jsonb(v_touched_plans)
  );
end;
$$;

revoke execute on function valtrim.apply_plan_option_changes(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function valtrim.apply_plan_option_changes(bigint, jsonb)
  to authenticated, service_role;

comment on function valtrim.apply_plan_option_changes(bigint, jsonb) is
  'Adds, edits and deletes Plans and Options of an active Job in one transaction. A Plan or Option that a Lot uses cannot be deleted; Options a Plan already has are skipped when added; deleted Plans come back when added again. ADMIN and PROJECT_MANAGEMENT only.';

notify pgrst, 'reload schema';

commit;
