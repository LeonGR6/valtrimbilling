-- Package edits own cell selection, notes and an audit reason. Billing period
-- dates are no longer accepted, validated, written or added to correction
-- history by this workflow. Existing historical values remain untouched.
begin;

set local lock_timeout = '5s';

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'CREATE OR REPLACE FUNCTION private.correct_draw_invoice_package(p_action text, p_package_id bigint, p_other_package_id bigint, p_selections jsonb, p_reason text, p_period_start date, p_period_end date, p_notes text)',
    'CREATE OR REPLACE FUNCTION private.correct_draw_invoice_package(p_action text, p_package_id bigint, p_other_package_id bigint, p_selections jsonb, p_reason text, p_notes text)'
  );

  if v_updated = v_definition then
    raise exception 'Correction function signature did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $original$    if p_period_start is not null and p_period_end is not null
       and p_period_end < p_period_start then
      raise exception 'Billing period end cannot precede its start'
        using errcode = '23514';
    end if;
$original$,
    ''
  );

  if v_updated = v_definition then
    raise exception 'Billing period validation did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $original$    v_old_details := jsonb_build_object(
      'period_start', v_target.billing_period_start,
      'period_end', v_target.billing_period_end,
      'notes', v_target.notes
    );
    v_new_details := jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'notes', v_notes
    );$original$,
    $replacement$    v_old_details := jsonb_build_object('notes', v_target.notes);
    v_new_details := jsonb_build_object('notes', v_notes);$replacement$
  );

  if v_updated = v_definition then
    raise exception 'Correction history billing period details did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $original$        billing_period_start = p_period_start,
        billing_period_end = p_period_end,
        notes = v_notes,$original$,
    $replacement$        notes = v_notes,$replacement$
  );

  if v_updated = v_definition then
    raise exception 'Package billing period update did not match the expected definition';
  end if;

  if v_updated like '%p_period_start%'
     or v_updated like '%p_period_end%'
     or v_updated like '%Billing period end cannot precede%'
     or v_updated like '%''period_start''%'
     or v_updated like '%''period_end''%' then
    raise exception 'Billing period edit behavior remains in the new correction definition';
  end if;

  execute v_updated;
end;
$migration$;

-- Remove the old wrappers before retiring the old private overload. Recreate
-- all wrappers together so every correction path targets one private function.
drop function valtrim.edit_draw_invoice_package(
  bigint, jsonb, text, date, date, text
);
drop function valtrim.transfer_draw_package_cells(
  bigint, bigint, jsonb, text
);
drop function valtrim.cancel_draw_invoice_package(bigint, text);
drop function private.correct_draw_invoice_package(
  text, bigint, bigint, jsonb, text, date, date, text
);

create function valtrim.edit_draw_invoice_package(
  p_package_id bigint,
  p_selections jsonb,
  p_reason text,
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.correct_draw_invoice_package(
    'EDIT', p_package_id, null, p_selections, p_reason, p_notes
  );
$$;

create function valtrim.transfer_draw_package_cells(
  p_to_package_id bigint,
  p_from_package_id bigint,
  p_selections jsonb,
  p_reason text
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.correct_draw_invoice_package(
    'TRANSFER', p_to_package_id, p_from_package_id, p_selections,
    p_reason, null
  );
$$;

create function valtrim.cancel_draw_invoice_package(
  p_package_id bigint,
  p_reason text
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.correct_draw_invoice_package(
    'CANCEL', p_package_id, null, null, p_reason, null
  );
$$;

revoke execute on function private.correct_draw_invoice_package(
  text, bigint, bigint, jsonb, text, text
) from public, anon, authenticated;
revoke execute on function valtrim.edit_draw_invoice_package(
  bigint, jsonb, text, text
) from public, anon, authenticated;
revoke execute on function valtrim.transfer_draw_package_cells(
  bigint, bigint, jsonb, text
) from public, anon, authenticated;
revoke execute on function valtrim.cancel_draw_invoice_package(
  bigint, text
) from public, anon, authenticated;

grant execute on function private.correct_draw_invoice_package(
  text, bigint, bigint, jsonb, text, text
) to authenticated, service_role;
grant execute on function valtrim.edit_draw_invoice_package(
  bigint, jsonb, text, text
) to authenticated, service_role;
grant execute on function valtrim.transfer_draw_package_cells(
  bigint, bigint, jsonb, text
) to authenticated, service_role;
grant execute on function valtrim.cancel_draw_invoice_package(
  bigint, text
) to authenticated, service_role;

comment on function private.correct_draw_invoice_package(
  text, bigint, bigint, jsonb, text, text
) is
  'Edits, transfers or cancels draft Package cells across Phases of one immutable Job. Edit metadata is limited to Package notes.';
comment on function valtrim.edit_draw_invoice_package(
  bigint, jsonb, text, text
) is
  'Edits draft Package selections and notes atomically, keeping unchanged snapshots. Billing period dates cannot be edited.';
comment on function valtrim.transfer_draw_package_cells(
  bigint, bigint, jsonb, text
) is
  'Moves exact Lot / Draw cells between editable Packages without duplicate ownership.';
comment on function valtrim.cancel_draw_invoice_package(bigint, text) is
  'Cancels a draft Package, releases its cells and preserves an auditable header.';

notify pgrst, 'reload schema';

commit;
