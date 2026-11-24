-- Correct the customer's email from "Send to customer" (24 Nov 2026). The coordinator checks
-- the email with the customer before a proposal or a confirmation goes out and can fix it on
-- the spot: it is saved to the request and its primary contact without a new review, and the
-- email is then sent to the corrected address. The Edge Functions customer-service-proposals
-- and customer-service-appointments call it before validating the send, so the request's
-- updated_at they check afterwards is the one this write leaves.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function valtrim.update_customer_service_customer_email(
  p_actor_id uuid,
  p_request_id bigint,
  p_expected_updated_at timestamptz,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text := lower(btrim(p_email));
  v_request valtrim.service_requests%rowtype;
begin
  if not exists (
    select 1 from valtrim.app_users app_user
    where app_user.id = p_actor_id and app_user.is_active and app_user.role::text in ('ADMIN', 'SCHEDULING')
  ) then
    raise exception 'You do not have permission to change Customer Service requests' using errcode = '42501';
  end if;
  if v_email is null or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid customer email' using errcode = '22023';
  end if;

  select * into v_request from valtrim.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'The Customer Service request was not found' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is null or v_request.updated_at is distinct from p_expected_updated_at then
    raise exception 'This request changed after you opened it. Reload requests and review the plan again.'
      using errcode = '40001';
  end if;
  if v_request.workflow_stage not in ('READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT')
     or v_request.closed_at is not null then
    raise exception 'Only an open request being planned can have its customer email corrected here'
      using errcode = '55000';
  end if;
  if v_request.homeowner_email is not distinct from v_email then
    return jsonb_build_object('requestId', p_request_id, 'updatedAt', v_request.updated_at, 'changed', false);
  end if;

  update valtrim.service_requests
  set homeowner_email = v_email, updated_by = p_actor_id
  where id = p_request_id
  returning * into v_request;

  update valtrim.service_request_contacts
  set email = v_email, updated_by = p_actor_id
  where request_id = p_request_id and role = 'PRIMARY';

  return jsonb_build_object('requestId', p_request_id, 'updatedAt', v_request.updated_at, 'changed', true);
end;
$function$;

revoke all on function valtrim.update_customer_service_customer_email(uuid, bigint, timestamptz, text)
  from public, anon, authenticated;
grant execute on function valtrim.update_customer_service_customer_email(uuid, bigint, timestamptz, text)
  to service_role;
comment on function valtrim.update_customer_service_customer_email(uuid, bigint, timestamptz, text) is
  'Service role only (Send to customer). Saves a corrected customer email to the request and its primary contact, as the coordinator, without a new review. Rejects a stale request with 40001.';

notify pgrst, 'reload schema';
commit;
