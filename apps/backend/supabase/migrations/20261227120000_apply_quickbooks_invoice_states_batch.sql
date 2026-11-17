-- Records what QuickBooks shows for several Packages in one call.
--
-- The payments check (scheduler every 30 minutes, and every time the Packages
-- screen is opened) called valtrim.apply_quickbooks_invoice_state once per
-- Package, and every call is a request to the API that is logged. With about a
-- hundred Packages that was hundreds of requests per check. This function takes
-- a list and calls the same function for each one, so the rules are the same;
-- only the number of requests changes.
--
-- A Package that fails (no invoice, unknown state) is reported in its own row and
-- does not undo the others: each one runs in its own sub-transaction.
--
-- Each element of p_states:
--   { "package_id": 1, "state": "OPEN", "total": 100, "balance": 100,
--     "due_date": "2026-11-30" | null, "overdue": false,
--     "linked": ["Payment"], "qbo_last_updated": "2026-11-13T10:00:00Z" | null }
--
-- Returns one element per Package:
--   { "package_id": 1, "workflow_status": "AWAITING_PAYMENT" | null, "error": null | "..." }

create function valtrim.apply_quickbooks_invoice_states(p_states jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_workflow text;
  v_results jsonb := '[]'::jsonb;
begin
  if p_states is null or jsonb_typeof(p_states) <> 'array' then
    raise exception 'Send the QuickBooks states as a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_states) > 200 then
    raise exception 'At most 200 Packages per call' using errcode = '22023';
  end if;

  for v_item in select element.value from jsonb_array_elements(p_states) as element loop
    begin
      v_workflow := valtrim.apply_quickbooks_invoice_state(
        (v_item ->> 'package_id')::bigint,
        v_item ->> 'state',
        (v_item ->> 'total')::numeric,
        (v_item ->> 'balance')::numeric,
        nullif(v_item ->> 'due_date', '')::date,
        coalesce((v_item ->> 'overdue')::boolean, false),
        coalesce(
          array(select linked.value from jsonb_array_elements_text(v_item -> 'linked') as linked),
          '{}'::text[]
        ),
        nullif(v_item ->> 'qbo_last_updated', '')::timestamptz
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'package_id', v_item -> 'package_id',
        'workflow_status', v_workflow,
        'error', null
      ));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'package_id', v_item -> 'package_id',
        'workflow_status', null,
        'error', left(sqlerrm, 300)
      ));
    end;
  end loop;

  return v_results;
end;
$$;

revoke all on function valtrim.apply_quickbooks_invoice_states(jsonb)
  from public, anon, authenticated;
grant execute on function valtrim.apply_quickbooks_invoice_states(jsonb)
  to service_role;

comment on function valtrim.apply_quickbooks_invoice_states(jsonb) is
  'Service-role-only: applies valtrim.apply_quickbooks_invoice_state to a list of Packages in one call; one failing Package does not undo the others.';
