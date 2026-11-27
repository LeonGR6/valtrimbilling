-- Each role has an area of its own.
--
--   PROJECT_MANAGEMENT  Jobs, Plans & Options, Plan Pricing, Purchase Orders, Change Orders
--   ACCOUNTING          Draw & Invoice (Packages, documents, notes, QuickBooks) and Builder Setup
--   SCHEDULING          Calendar (Production activities, Builder dates, follow-ups) and Sequence Sheets
--   CUSTOMER_SERVICE    Customer Service (a new role; its screen keeps its data in the browser for now,
--                       so it owns no table yet)
--   ADMIN               everything, and the only one that manages users, People, Builder Contacts and the
--                       QuickBooks / Google connections
--
-- Until now PROJECT_MANAGEMENT did the work of three of them. Reading is not touched: every active user
-- still reads what they read before (the modules lean on each other: the Calendar reads Jobs and Phases,
-- a Package reads the Calendar). What moves is who can change things.
--
-- The role lists live inside the bodies of 50 functions, so they are swapped in place instead of retyping
-- the bodies: each function is read back with pg_get_functiondef, only the list of its has_app_role call
-- changes, and it is created again. The migration stops (and rolls back) if a function does not hold
-- exactly the list it is expected to hold, or does not hold the new one afterwards.
--
-- Two things stay open to PROJECT_MANAGEMENT on purpose:
--   * the triggers that guard Package lines (prepare_draw_package, reject_package_line_change and
--     reject_package_hardware_line_change) accept ADMIN, ACCOUNTING and PROJECT_MANAGEMENT, because a
--     price change by PROJECT_MANAGEMENT recalculates the draft Packages that use it;
--   * deleting the PDFs of a Package from Storage, for the same reason (the old documents of a recalculated
--     draft Package are removed).
-- Builders are created and edited from the Jobs screen, so their policies are unchanged.

begin;

alter type valtrim.app_role add value if not exists 'CUSTOMER_SERVICE' before 'FIELD';

-- The roles named by the first has_app_role call of a piece of SQL, sorted.
create function pg_temp.role_set_of(p_source text)
returns text[]
language sql
as $$
  select array_agg(distinct token[1] order by token[1])
  from regexp_matches(
    (regexp_match(p_source, 'has_app_role\s*\(([^()]*)\)'))[1],
    '''([A-Z_]+)''',
    'g'
  ) as token
$$;

-- The same SQL with every has_app_role call that names exactly p_old now naming p_new.
create function pg_temp.swap_roles(p_source text, p_old text[], p_new text[])
returns text
language plpgsql
as $$
declare
  v_result text := p_source;
  v_call text[];
  v_list text;
begin
  select string_agg(quote_literal(new_roles.role), ', ' order by new_roles.position)
  into v_list
  from unnest(p_new) with ordinality as new_roles(role, position);

  for v_call in
    select call
    from regexp_matches(p_source, '(has_app_role\s*\(([^()]*)\))', 'g') as call
  loop
    if pg_temp.role_set_of(v_call[1]) is not distinct from (
      select array_agg(distinct old_roles.role order by old_roles.role)
      from unnest(p_old) as old_roles(role)
    ) then
      v_result := replace(v_result, v_call[1], 'has_app_role(' || v_list || ')');
    end if;
  end loop;

  return v_result;
end;
$$;

-- How the comments of the functions word a list: 'ADMIN and ACCOUNTING only.'
create function pg_temp.roles_phrase(p_roles text[])
returns text
language sql
as $$
  select case cardinality(p_roles)
    when 1 then p_roles[1] || ' only.'
    when 2 then p_roles[1] || ' and ' || p_roles[2] || ' only.'
    else array_to_string(p_roles[1:cardinality(p_roles) - 1], ', ')
      || ' and ' || p_roles[cardinality(p_roles)] || ' only.'
  end
$$;

do $roles$
declare
  v_change record;
  v_function record;
  v_definition text;
  v_swapped text;
  v_swaps integer;
  v_comment text;
  v_policy record;
  v_using text;
  v_check text;
begin
  for v_change in
    select *
    from (values
      -- Draw & Invoice: whoever bills creates, corrects and moves the Packages.
      ('private', 'create_draw_invoice_package', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'create_draw_invoice_package_with_hardware_events', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'create_options_package', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'create_price_adjustment_package', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'create_retention_release_package', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'correct_draw_invoice_package', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'set_draw_package_workflow_status', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      -- The guards of the Package lines also let a price change of PROJECT_MANAGEMENT recalculate drafts.
      ('valtrim', 'prepare_draw_package', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']),
      ('valtrim', 'reject_package_line_change', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']),
      ('valtrim', 'reject_package_hardware_line_change', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']),
      -- Documents and notes of the Packages and Jobs they bill.
      ('private', 'add_draw_package_note', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'add_job_note', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'mark_package_submitted_internal', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'register_job_document', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'delete_job_document', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'register_package_release', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'delete_package_release', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'register_package_payment_schedule', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'delete_package_payment_schedule', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'confirm_release_template', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('private', 'confirm_payment_schedule_template', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      -- Builder Setup.
      ('valtrim', 'save_builder_billing_setup', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('valtrim', 'deactivate_builder_billing_setup', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      -- Calendar.
      ('private', 'save_production_activity', array['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'], array['ADMIN', 'SCHEDULING']),
      ('private', 'cancel_production_activity', array['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'], array['ADMIN', 'SCHEDULING']),
      ('private', 'save_builder_date_configuration', array['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'], array['ADMIN', 'SCHEDULING']),
      ('private', 'record_builder_follow_up_status', array['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'], array['ADMIN', 'SCHEDULING']),
      ('private', 'refresh_builder_follow_up_checkpoints', array['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'], array['ADMIN', 'SCHEDULING']),
      ('private', 'refresh_builder_follow_up_escalations', array['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'], array['ADMIN', 'SCHEDULING']),
      ('valtrim', 'resolve_builder_follow_up_reschedule_request', array['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'], array['ADMIN', 'SCHEDULING']),
      -- Sequence Sheets.
      ('valtrim', 'save_sequence_sheet_phase', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'SCHEDULING']),
      ('valtrim', 'deactivate_sequence_sheet_phase', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN', 'SCHEDULING']),
      -- People: only ADMIN adds or changes them.
      ('private', 'create_company_contact_internal', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN']),
      ('private', 'create_supervisor_internal', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN']),
      ('private', 'set_company_contact_roles_internal', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN'])
    ) as change(schema_name, function_name, old_roles, new_roles)
  loop
    v_swaps := 0;

    for v_function in
      select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = v_change.schema_name
        and p.proname = v_change.function_name
    loop
      v_definition := pg_get_functiondef(v_function.oid);
      v_swapped := pg_temp.swap_roles(v_definition, v_change.old_roles, v_change.new_roles);

      if v_swapped is distinct from v_definition then
        execute v_swapped;
        v_swaps := v_swaps + 1;

        if pg_temp.role_set_of(pg_get_functiondef(v_function.oid)) is distinct from (
          select array_agg(distinct new_roles.role order by new_roles.role)
          from unnest(v_change.new_roles) as new_roles(role)
        ) then
          raise exception '%.% does not name % after the change',
            v_change.schema_name, v_change.function_name, v_change.new_roles;
        end if;
      end if;
    end loop;

    if v_swaps <> 1 then
      raise exception '%.% was expected to name % in exactly one function, and % did',
        v_change.schema_name, v_change.function_name, v_change.old_roles, v_swaps;
    end if;

    -- The comments of the function, and of its public wrapper, say who may call it.
    for v_function in
      select p.oid, obj_description(p.oid, 'pg_proc') as comment
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('valtrim', 'private')
        and p.proname = v_change.function_name
        and obj_description(p.oid, 'pg_proc') is not null
    loop
      v_comment := replace(
        v_function.comment,
        pg_temp.roles_phrase(v_change.old_roles),
        pg_temp.roles_phrase(v_change.new_roles)
      );

      if v_comment <> v_function.comment then
        execute format('comment on function %s is %L', v_function.oid::regprocedure, v_comment);
      end if;
    end loop;
  end loop;

  -- Policies.
  for v_change in
    select *
    from (values
      ('valtrim', 'builder_contact_types', 'builder_contact_types_insert', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN']),
      ('valtrim', 'builder_contacts', 'builder_contacts_insert', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN']),
      ('valtrim', 'builder_contacts', 'builder_contacts_update', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN']),
      ('valtrim', 'people', 'company_people_update', array['ADMIN', 'PROJECT_MANAGEMENT'], array['ADMIN']),
      ('valtrim', 'job_notes', 'job_notes_select', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('storage', 'objects', 'job_documents_objects_insert', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING']),
      ('storage', 'objects', 'package_documents_objects_insert', array['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT'], array['ADMIN', 'ACCOUNTING'])
    ) as change(schema_name, table_name, policy_name, old_roles, new_roles)
  loop
    select policy.qual, policy.with_check
    into v_policy
    from pg_policies policy
    where policy.schemaname = v_change.schema_name
      and policy.tablename = v_change.table_name
      and policy.policyname = v_change.policy_name;

    if not found then
      raise exception 'Policy % on %.% does not exist',
        v_change.policy_name, v_change.schema_name, v_change.table_name;
    end if;

    v_using := case when v_policy.qual is null then null
      else pg_temp.swap_roles(v_policy.qual, v_change.old_roles, v_change.new_roles) end;
    v_check := case when v_policy.with_check is null then null
      else pg_temp.swap_roles(v_policy.with_check, v_change.old_roles, v_change.new_roles) end;

    if v_using is not distinct from v_policy.qual and v_check is not distinct from v_policy.with_check then
      raise exception 'Policy % on %.% does not name %',
        v_change.policy_name, v_change.schema_name, v_change.table_name, v_change.old_roles;
    end if;

    execute format(
      'alter policy %I on %I.%I%s%s',
      v_change.policy_name,
      v_change.schema_name,
      v_change.table_name,
      case when v_using is null then '' else format(' using (%s)', v_using) end,
      case when v_check is null then '' else format(' with check (%s)', v_check) end
    );

    select policy.qual, policy.with_check
    into v_policy
    from pg_policies policy
    where policy.schemaname = v_change.schema_name
      and policy.tablename = v_change.table_name
      and policy.policyname = v_change.policy_name;

    if pg_temp.role_set_of(coalesce(v_policy.qual, v_policy.with_check)) is distinct from (
      select array_agg(distinct new_roles.role order by new_roles.role)
      from unnest(v_change.new_roles) as new_roles(role)
    ) then
      raise exception 'Policy % on %.% does not name % after the change',
        v_change.policy_name, v_change.schema_name, v_change.table_name, v_change.new_roles;
    end if;
  end loop;
end;
$roles$;

comment on policy job_notes_select on valtrim.job_notes
  is 'ADMIN and ACCOUNTING can read Job notes.';

commit;
