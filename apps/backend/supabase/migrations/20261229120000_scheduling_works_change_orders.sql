-- SCHEDULING also works Extras / Change Orders.
--
-- Until now SCHEDULING owned the Calendar and the Sequence Sheets and could only open a Change Order from a
-- CO event of the Calendar. Now it creates, edits, moves between statuses, writes the PO / CO # and deletes
-- Extras / COs, like PROJECT_MANAGEMENT. What does not change:
--   * only ADMIN approves a Change Order, creates one already approved, or cancels an approved one (those
--     has_app_role('ADMIN') calls are left as they are);
--   * Jobs, Plans & Options and Pricing stay with ADMIN and PROJECT_MANAGEMENT;
--   * the functions that invoice a Change Order stay with ADMIN, ACCOUNTING and DRAW_INVOICE;
--   * the events of their own of a Change Order already belonged to ADMIN, PROJECT_MANAGEMENT and SCHEDULING.
--
-- Same method as the role responsibilities migration: each function is read back with pg_get_functiondef,
-- only the has_app_role call that names exactly ADMIN and PROJECT_MANAGEMENT changes, and the function is
-- created again (grants and settings are kept). The migration stops, and rolls back, if a function does not
-- hold exactly the list it is expected to hold, or does not hold the new one afterwards.

begin;

-- The roles named by a has_app_role call, sorted.
create function pg_temp.role_set_of(p_call text)
returns text[]
language sql
as $$
  select array_agg(distinct token[1] order by token[1])
  from regexp_matches(p_call, '''([A-Z_]+)''', 'g') as token
$$;

do $roles$
declare
  v_old constant text[] := array['ADMIN', 'PROJECT_MANAGEMENT'];
  v_new constant text[] := array['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'];
  v_name text;
  v_function record;
  v_definition text;
  v_swapped text;
  v_call text[];
  v_swaps integer;
  v_total integer;
  v_comment text;
begin
  foreach v_name in array array[
    'create_change_order',
    'update_change_order',
    'set_change_order_status',
    'set_change_order_po_co_number',
    'delete_change_order',
    'peek_change_order_number'
  ]
  loop
    v_swaps := 0;

    for v_function in
      select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = v_name
    loop
      v_definition := pg_get_functiondef(v_function.oid);
      v_swapped := v_definition;
      v_total := 0;

      for v_call in
        select call
        from regexp_matches(v_definition, '(has_app_role\s*\(([^()]*)\))', 'g') as call
      loop
        if pg_temp.role_set_of(v_call[1]) = v_old then
          v_swapped := replace(
            v_swapped,
            v_call[1],
            'has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'', ''SCHEDULING'')'
          );
          v_total := v_total + 1;
        end if;
      end loop;

      if v_total > 0 then
        execute v_swapped;
        v_swaps := v_swaps + 1;

        if not exists (
          select 1
          from regexp_matches(pg_get_functiondef(v_function.oid), '(has_app_role\s*\(([^()]*)\))', 'g') as call
          where pg_temp.role_set_of(call[1]) = v_new
        ) or exists (
          select 1
          from regexp_matches(pg_get_functiondef(v_function.oid), '(has_app_role\s*\(([^()]*)\))', 'g') as call
          where pg_temp.role_set_of(call[1]) = v_old
        ) then
          raise exception 'private.% does not name % after the change', v_name, v_new;
        end if;
      end if;
    end loop;

    if v_swaps <> 1 then
      raise exception 'private.% was expected to name % in exactly one function, and % did',
        v_name, v_old, v_swaps;
    end if;

    -- The comment of the public wrapper says who may call it.
    for v_function in
      select p.oid, obj_description(p.oid, 'pg_proc') as comment
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'valtrim' and p.proname = v_name
        and obj_description(p.oid, 'pg_proc') is not null
    loop
      v_comment := replace(
        v_function.comment,
        'ADMIN and PROJECT_MANAGEMENT',
        'ADMIN, PROJECT_MANAGEMENT and SCHEDULING'
      );

      if v_comment <> v_function.comment then
        execute format('comment on function %s is %L', v_function.oid::regprocedure, v_comment);
      end if;
    end loop;
  end loop;
end
$roles$;

commit;
