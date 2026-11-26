-- Block B, step B1 (docs/customer-service-block-b-plan.md): store sent proposals.
--
-- A proposal offers the customer one or two options and holds them until the
-- customer answers (decided 18-19 Nov 2026; no expiry). Capacity rules stay in
-- functions/_shared/customerServiceScheduling.mjs: these RPCs only store what an
-- Edge Function validated, serialize writes per technician and day with the same
-- advisory locks as appointments, and keep integrity checks.
--
-- The customer link signs public_id with a secret held by the Edge Function, as
-- Builder follow-ups do; no token is stored, and the link stops working once the
-- proposal leaves SENT. That replaces private.service_confirmation_tokens.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if exists (select 1 from private.service_confirmation_tokens) then
    raise exception 'Confirmation tokens exist and need an explicit mapping; no changes were applied'
      using errcode = '55000';
  end if;
end;
$preflight$;

drop table private.service_confirmation_tokens;

create type valtrim.service_proposal_status as enum (
  'SENT', 'ACCEPTED', 'REJECTED', 'COUNTER_PROPOSED', 'CANCELLED'
);
-- Who recorded the customer's answer: a coordinator (phone call or email reply)
-- or the customer through the link.
create type valtrim.service_response_channel as enum ('COORDINATOR', 'CUSTOMER_LINK');
create type valtrim.service_day_part as enum ('MORNING', 'MIDDAY', 'AFTERNOON');

-- 1. Proposals: one row per invitation sent to the customer.
create table valtrim.service_proposals (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  request_id bigint not null references valtrim.service_requests(id) on delete cascade,
  status valtrim.service_proposal_status not null default 'SENT',
  sender_mailbox valtrim.email_address not null,
  sent_at timestamptz not null default now(),
  reminder_sent_at timestamptz,
  builder_contacted_at timestamptz,
  responded_at timestamptz,
  response_via valtrim.service_response_channel,
  accepted_option_id bigint,
  counter_dates date[],
  counter_day_part valtrim.service_day_part,
  customer_note varchar(1000),
  cancelled_at timestamptz,
  cancel_reason varchar(500),
  created_by uuid references valtrim.app_users(id) on delete set null,
  updated_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_proposals_answer_check check (
    (status in ('ACCEPTED', 'REJECTED', 'COUNTER_PROPOSED'))
      = (responded_at is not null and response_via is not null)
    and (responded_at is not null or response_via is null)
  ),
  constraint service_proposals_accepted_check check ((status = 'ACCEPTED') = (accepted_option_id is not null)),
  constraint service_proposals_counter_check check (
    (status = 'COUNTER_PROPOSED') = (counter_dates is not null)
    and (counter_dates is null or (cardinality(counter_dates) between 1 and 3
      and array_position(counter_dates, null) is null))
    and (status = 'COUNTER_PROPOSED' or counter_day_part is null)
  ),
  constraint service_proposals_cancel_check check (
    (status = 'CANCELLED') = (cancelled_at is not null)
    and (status = 'CANCELLED') = (nullif(btrim(cancel_reason), '') is not null)
  ),
  constraint service_proposals_follow_up_check check (
    (reminder_sent_at is null or reminder_sent_at >= sent_at)
    and (builder_contacted_at is null or builder_contacted_at >= sent_at)
  )
);

-- A request waits on one proposal at a time.
create unique index service_proposals_one_sent_idx
  on valtrim.service_proposals (request_id) where status = 'SENT';
create index service_proposals_request_idx on valtrim.service_proposals (request_id, sent_at desc);

comment on table valtrim.service_proposals is
  'Customer Service invitations. A SENT proposal holds its options until the customer answers or a coordinator cancels it.';
comment on column valtrim.service_proposals.public_id is
  'Signed by the Edge Function into the customer link; the link only works while the proposal is SENT.';
comment on column valtrim.service_proposals.sender_mailbox is
  'Company mailbox of the coordinator who sent it; the reminder leaves from the same mailbox.';

-- 2. Options: the same shape as an appointment. Insert-only.
create table valtrim.service_proposal_options (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references valtrim.service_proposals(id) on delete cascade,
  option_number smallint not null check (option_number between 1 and 2),
  technician_ids bigint[] not null,
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  pickup_minutes smallint not null check (pickup_minutes between 0 and 60),
  unique (proposal_id, option_number),
  unique (id, proposal_id),
  constraint service_proposal_options_technicians_check
    check (cardinality(technician_ids) between 1 and 10 and array_position(technician_ids, null) is null),
  constraint service_proposal_options_window_check
    check (window_ends_at = window_starts_at + interval '2 hours'),
  constraint service_proposal_options_work_in_window_check
    check (starts_at >= window_starts_at and starts_at < window_ends_at
      and ends_at > starts_at
      and ends_at + pickup_minutes * interval '1 minute' <= window_ends_at)
);

create index service_proposal_options_technicians_idx
  on valtrim.service_proposal_options using gin (technician_ids);
create index service_proposal_options_window_idx
  on valtrim.service_proposal_options (window_starts_at);

-- The accepted option must belong to the same proposal.
alter table valtrim.service_proposals
  add constraint service_proposals_accepted_option_fkey
  foreign key (accepted_option_id, id)
  references valtrim.service_proposal_options (id, proposal_id);

comment on table valtrim.service_proposal_options is
  'Days offered in a proposal. While the proposal is SENT they occupy their technicians like an appointment.';

-- 3. How each appointment was accepted. Every appointment registered before
-- block B was recorded by a coordinator.
alter table valtrim.service_appointments
  add column accepted_via valtrim.service_response_channel not null default 'COORDINATOR',
  add column proposal_id bigint references valtrim.service_proposals(id),
  add constraint service_appointments_link_needs_proposal_check
    check (accepted_via <> 'CUSTOMER_LINK' or proposal_id is not null);

create unique index service_appointments_proposal_idx
  on valtrim.service_appointments (proposal_id) where proposal_id is not null;

comment on column valtrim.service_appointments.accepted_via is
  'COORDINATOR: recorded by a coordinator (phone or email reply). CUSTOMER_LINK: the customer chose it in the proposal link.';
comment on column valtrim.service_appointments.proposal_id is 'The proposal whose option became this appointment, if any.';

-- The appointment audit also records how it was accepted.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef('private.audit_service_appointment_change()'::regprocedure);
  v_patched text;
begin
  v_patched := replace(v_definition,
    $old$'acceptance', new.acceptance::text,$old$,
    $new$'acceptance', new.acceptance::text, 'accepted_via', new.accepted_via::text, 'proposal_id', new.proposal_id,$new$);
  v_patched := replace(v_patched,
    $old$'acceptance', old.acceptance::text,$old$,
    $new$'acceptance', old.acceptance::text, 'accepted_via', old.accepted_via::text, 'proposal_id', old.proposal_id,$new$);
  if (length(v_patched) - length(v_definition))
     <> 2 * length($add$ 'accepted_via', new.accepted_via::text, 'proposal_id', new.proposal_id,$add$) then
    raise exception 'Appointment audit snapshot not found; nothing was changed';
  end if;
  execute v_patched;
end;
$patch$;

-- 4. Housekeeping triggers and the audit trail.
create trigger service_proposals_set_updated_at
before update on valtrim.service_proposals
for each row execute function valtrim.set_updated_at();

create trigger stamp_and_validate_actor
before insert or update on valtrim.service_proposals
for each row execute function private.stamp_and_validate_actor();

create function private.audit_service_proposal_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system boolean := coalesce(current_setting('valtrim.system_actor', true), '') = 'on';
  v_actor_candidate uuid := case
    when v_system then null
    when tg_op = 'INSERT' then coalesce((select auth.uid()), new.created_by)
    else coalesce((select auth.uid()), new.updated_by)
  end;
  v_actor_id uuid;
  v_actor_name text;
  v_actor_email valtrim.email_address;
  v_actor_role text;
  v_request_folio text;
  v_customer_name text;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_previous_values jsonb := '{}'::jsonb;
  v_new_values jsonb;
  v_changed_fields text[] := array[]::text[];
  v_action text;
  v_summary text;
  v_customer_answer boolean := false;
begin
  select app_user.id, app_user.name, app_user.email, app_user.role::text
  into v_actor_id, v_actor_name, v_actor_email, v_actor_role
  from valtrim.app_users app_user
  where app_user.id = v_actor_candidate;

  select request.folio, request.homeowner_name
  into v_request_folio, v_customer_name
  from valtrim.service_requests request
  where request.id = new.request_id;

  v_new_snapshot := jsonb_build_object(
    'status', new.status::text,
    'sender_mailbox', new.sender_mailbox,
    'sent_at', new.sent_at,
    'reminder_sent_at', new.reminder_sent_at,
    'builder_contacted_at', new.builder_contacted_at,
    'responded_at', new.responded_at,
    'response_via', new.response_via::text,
    'accepted_option_id', new.accepted_option_id,
    'counter_dates', to_jsonb(new.counter_dates),
    'counter_day_part', new.counter_day_part::text,
    'customer_note', new.customer_note,
    'cancelled_at', new.cancelled_at,
    'cancel_reason', new.cancel_reason
  );

  if tg_op = 'INSERT' then
    -- Deferred to commit, so the options inserted after the proposal are here.
    v_action := 'SERVICE_PROPOSAL_SENT';
    v_new_values := v_new_snapshot || jsonb_build_object('options', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'option_id', option.id,
        'option_number', option.option_number,
        'technician_ids', to_jsonb(option.technician_ids),
        'window_starts_at', option.window_starts_at,
        'window_ends_at', option.window_ends_at,
        'starts_at', option.starts_at,
        'ends_at', option.ends_at,
        'pickup_minutes', option.pickup_minutes
      ) order by option.option_number), '[]'::jsonb)
      from valtrim.service_proposal_options option
      where option.proposal_id = new.id
    ));
    select array_agg(field.key order by field.key) into v_changed_fields from jsonb_each(v_new_values) field;
    v_summary := format('A proposal was sent for %s.', v_request_folio);
  else
    v_old_snapshot := jsonb_build_object(
      'status', old.status::text,
      'sender_mailbox', old.sender_mailbox,
      'sent_at', old.sent_at,
      'reminder_sent_at', old.reminder_sent_at,
      'builder_contacted_at', old.builder_contacted_at,
      'responded_at', old.responded_at,
      'response_via', old.response_via::text,
      'accepted_option_id', old.accepted_option_id,
      'counter_dates', to_jsonb(old.counter_dates),
      'counter_day_part', old.counter_day_part::text,
      'customer_note', old.customer_note,
      'cancelled_at', old.cancelled_at,
      'cancel_reason', old.cancel_reason
    );

    select
      coalesce(jsonb_object_agg(change.key, v_old_snapshot -> change.key), '{}'::jsonb),
      coalesce(jsonb_object_agg(change.key, change.value), '{}'::jsonb),
      coalesce(array_agg(change.key order by change.key), array[]::text[])
    into v_previous_values, v_new_values, v_changed_fields
    from jsonb_each(v_new_snapshot) change
    where v_old_snapshot -> change.key is distinct from change.value;

    if cardinality(v_changed_fields) = 0 then
      return new;
    end if;
    v_customer_answer := new.response_via = 'CUSTOMER_LINK' and old.status = 'SENT' and new.status <> 'SENT';

    if old.status is distinct from new.status and new.status = 'ACCEPTED' then
      v_action := 'SERVICE_PROPOSAL_ACCEPTED';
      v_summary := format('The proposal for %s was accepted.', v_request_folio);
    elsif old.status is distinct from new.status and new.status = 'REJECTED' then
      v_action := 'SERVICE_PROPOSAL_REJECTED';
      v_summary := format('The proposal for %s was rejected.', v_request_folio);
    elsif old.status is distinct from new.status and new.status = 'COUNTER_PROPOSED' then
      v_action := 'SERVICE_PROPOSAL_COUNTER_PROPOSED';
      v_summary := format('The customer asked for other dates for %s.', v_request_folio);
    elsif old.status is distinct from new.status and new.status = 'CANCELLED' then
      v_action := 'SERVICE_PROPOSAL_CANCELLED';
      v_summary := format('The proposal for %s was cancelled.', v_request_folio);
    elsif old.reminder_sent_at is null and new.reminder_sent_at is not null then
      v_action := 'SERVICE_PROPOSAL_REMINDER_SENT';
      v_summary := format('A reminder was sent for the proposal for %s.', v_request_folio);
    elsif old.builder_contacted_at is null and new.builder_contacted_at is not null then
      v_action := 'SERVICE_PROPOSAL_BUILDER_CONTACTED';
      v_summary := format('The Builder was contacted about the proposal for %s.', v_request_folio);
    else
      v_action := 'SERVICE_PROPOSAL_UPDATED';
      v_summary := format('The proposal for %s was updated.', v_request_folio);
    end if;
  end if;

  insert into valtrim.audit_events (
    module, action, result, actor_type, actor_user_id, actor_name, actor_email,
    actor_role, target_name, entity_type, entity_id, entity_label, summary,
    previous_values, new_values, metadata
  )
  values (
    'CUSTOMER_SERVICE', v_action, 'SUCCESS',
    case when v_actor_id is null then 'SYSTEM' else 'USER' end,
    v_actor_id,
    coalesce(v_actor_name, case when v_customer_answer then 'Customer (proposal link)' else 'System' end),
    v_actor_email, v_actor_role,
    v_customer_name, 'SERVICE_PROPOSAL', new.id::text, v_request_folio, v_summary,
    v_previous_values, v_new_values,
    jsonb_build_object(
      'requestId', new.request_id,
      'requestFolio', v_request_folio,
      'changedFields', to_jsonb(v_changed_fields)
    )
  );

  return new;
end;
$$;

revoke all on function private.audit_service_proposal_change() from public, anon, authenticated;

create constraint trigger customer_service_proposals_audit_sent
after insert on valtrim.service_proposals
deferrable initially deferred
for each row execute function private.audit_service_proposal_change();

create trigger customer_service_proposals_audit
after update on valtrim.service_proposals
for each row execute function private.audit_service_proposal_change();

-- 5. Privileges: coordinators read; only the RPCs below write.
alter table valtrim.service_proposals enable row level security;
alter table valtrim.service_proposal_options enable row level security;
revoke all on valtrim.service_proposals, valtrim.service_proposal_options from public, anon, authenticated;
grant select on valtrim.service_proposals, valtrim.service_proposal_options to authenticated;

create policy service_proposals_select
on valtrim.service_proposals for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

create policy service_proposal_options_select
on valtrim.service_proposal_options for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

-- 6. Parsing helper: the options JSON the Edge Function sends, as rows.
create function private.service_proposal_option_slots(p_options jsonb)
returns table (
  option_number smallint,
  technician_ids bigint[],
  window_starts_at timestamptz,
  window_ends_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  pickup_minutes smallint
)
language sql
stable
set search_path = ''
as $$
  select
    option.ordinality::smallint,
    (select array_agg(technician.value::bigint order by technician.value::bigint)
     from jsonb_array_elements_text(option.value -> 'technicianIds') technician(value)),
    (option.value ->> 'windowStartsAt')::timestamptz,
    (option.value ->> 'windowEndsAt')::timestamptz,
    (option.value ->> 'startsAt')::timestamptz,
    (option.value ->> 'endsAt')::timestamptz,
    (option.value ->> 'pickupMinutes')::smallint
  from jsonb_array_elements(p_options) with ordinality as option(value, ordinality);
$$;

revoke all on function private.service_proposal_option_slots(jsonb) from public, anon, authenticated;

-- 7. Send: store a validated proposal, hold its options and wait for the customer.
create function valtrim.send_customer_service_proposal(
  p_actor_id uuid,
  p_request_id bigint,
  p_expected_request_updated_at timestamptz,
  p_expected_appointment_ids bigint[],
  p_expected_option_ids bigint[],
  p_sender_mailbox text,
  p_options jsonb,
  p_travel jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request valtrim.service_requests%rowtype;
  v_time_zone text;
  v_lock record;
  v_current_ids bigint[];
  v_proposal valtrim.service_proposals%rowtype;
  v_leg jsonb;
begin
  if not exists (
    select 1 from valtrim.app_users app_user
    where app_user.id = p_actor_id and app_user.is_active
      and app_user.role::text in ('ADMIN', 'SCHEDULING')
  ) then
    raise exception 'You do not have permission to send Customer Service proposals'
      using errcode = '42501';
  end if;
  if p_options is null or jsonb_typeof(p_options) is distinct from 'array'
     or p_travel is null or jsonb_typeof(p_travel) is distinct from 'array' then
    raise exception 'Proposal options and travel information are required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_options) not between 1 and 2 or exists (
    select 1 from jsonb_array_elements(p_options) option(value)
    where jsonb_typeof(option.value) is distinct from 'object'
       or jsonb_typeof(option.value -> 'technicianIds') is distinct from 'array'
       or option.value -> 'technicianIds' = '[]'::jsonb
       or option.value ->> 'windowStartsAt' is null
  ) then
    raise exception 'A proposal offers one or two options, each with technicians and a window'
      using errcode = '22023';
  end if;
  if nullif(btrim(p_sender_mailbox), '') is null then
    raise exception 'The sender mailbox is required' using errcode = '22023';
  end if;

  select settings.time_zone into strict v_time_zone
  from valtrim.service_scheduling_settings settings where settings.id = 1;

  -- Same locks as appointment registration, in one global (technician, day)
  -- order, so sends and registrations on those days run one at a time.
  begin
    for v_lock in
      select distinct technician_id, (slot.window_starts_at at time zone v_time_zone)::date as day
      from private.service_proposal_option_slots(p_options) slot
      cross join unnest(slot.technician_ids) technician_id
      order by 1, 2
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(format('service-appointments:%s:%s', v_lock.technician_id, v_lock.day), 0)
      );
    end loop;
  exception
    when data_exception then
      raise exception 'Proposal technicians or times have an invalid value' using errcode = '22023';
  end;

  select * into v_request from valtrim.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'The Customer Service request was not found' using errcode = 'P0002';
  end if;
  if p_expected_request_updated_at is null
     or v_request.updated_at is distinct from p_expected_request_updated_at then
    raise exception 'This request changed after you opened it. Reload requests and review the plan again.'
      using errcode = '40001';
  end if;
  if v_request.workflow_stage not in ('READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT')
     or v_request.closed_at is not null then
    raise exception 'Only an open request waiting for a proposal can be sent one'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from valtrim.service_proposals proposal
    where proposal.request_id = p_request_id and proposal.status = 'SENT'
  ) then
    raise exception 'This request already has a proposal waiting for the customer. Cancel it before sending another.'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from private.service_proposal_option_slots(p_options) slot
    where cardinality(slot.technician_ids) <> (
        select count(distinct technician_id) from unnest(slot.technician_ids) technician_id
      )
      or exists (
        select 1 from unnest(slot.technician_ids) technician_id
        where not exists (
          select 1 from valtrim.people person
          join valtrim.person_roles person_role
            on person_role.person_id = person.id and person_role.role = 'SERVICE_TECHNICIAN'
          where person.id = technician_id and person.is_active
        )
      )
  ) then
    raise exception 'Technicians must be distinct, active and have the SERVICE_TECHNICIAN role'
      using errcode = '23514';
  end if;

  -- The days the Edge Function validated must be unchanged: the same current
  -- appointments and the same held options for these technicians.
  select coalesce(array_agg(distinct appointment.id order by appointment.id), '{}'::bigint[])
  into v_current_ids
  from private.service_proposal_option_slots(p_options) slot
  join valtrim.service_appointments appointment
    on appointment.is_current
   and appointment.technician_ids && slot.technician_ids
   and (appointment.window_starts_at at time zone v_time_zone)::date
     = (slot.window_starts_at at time zone v_time_zone)::date;
  if v_current_ids is distinct from (
    select coalesce(array_agg(distinct expected.id order by expected.id), '{}'::bigint[])
    from unnest(coalesce(p_expected_appointment_ids, '{}'::bigint[])) expected(id)
  ) then
    raise exception 'The schedule changed. Review the plan again.' using errcode = '40001';
  end if;

  select coalesce(array_agg(distinct held.id order by held.id), '{}'::bigint[])
  into v_current_ids
  from private.service_proposal_option_slots(p_options) slot
  join valtrim.service_proposal_options held
    on held.technician_ids && slot.technician_ids
   and (held.window_starts_at at time zone v_time_zone)::date
     = (slot.window_starts_at at time zone v_time_zone)::date
  join valtrim.service_proposals proposal
    on proposal.id = held.proposal_id and proposal.status = 'SENT';
  if v_current_ids is distinct from (
    select coalesce(array_agg(distinct expected.id order by expected.id), '{}'::bigint[])
    from unnest(coalesce(p_expected_option_ids, '{}'::bigint[])) expected(id)
  ) then
    raise exception 'The schedule changed. Review the plan again.' using errcode = '40001';
  end if;

  insert into valtrim.service_proposals (request_id, sender_mailbox, created_by, updated_by)
  values (p_request_id, lower(btrim(p_sender_mailbox)), p_actor_id, p_actor_id)
  returning * into v_proposal;

  begin
    insert into valtrim.service_proposal_options (
      proposal_id, option_number, technician_ids, window_starts_at, window_ends_at,
      starts_at, ends_at, pickup_minutes
    )
    select v_proposal.id, slot.option_number, slot.technician_ids, slot.window_starts_at,
      slot.window_ends_at, slot.starts_at, slot.ends_at, slot.pickup_minutes
    from private.service_proposal_option_slots(p_options) slot;
  exception
    when data_exception then
      raise exception 'Proposal technicians or times have an invalid value' using errcode = '22023';
  end;

  for v_leg in select value from jsonb_array_elements(p_travel) loop
    insert into valtrim.service_travel_estimates (
      from_request_id, to_request_id, minutes, source, created_by, updated_by
    ) values (
      (v_leg ->> 'fromRequestId')::bigint, (v_leg ->> 'toRequestId')::bigint,
      (v_leg ->> 'minutes')::smallint, 'MANUAL', p_actor_id, p_actor_id
    )
    on conflict (from_request_id, to_request_id) do update
      set minutes = excluded.minutes, source = excluded.source, updated_by = excluded.updated_by;
  end loop;

  update valtrim.service_requests
  set workflow_stage = 'AWAITING_CUSTOMER', updated_by = p_actor_id
  where id = p_request_id and workflow_stage <> 'AWAITING_CUSTOMER';

  return jsonb_build_object(
    'proposalId', v_proposal.id,
    'publicId', v_proposal.public_id,
    'requestId', p_request_id,
    'optionIds', (
      select jsonb_agg(option.id order by option.option_number)
      from valtrim.service_proposal_options option where option.proposal_id = v_proposal.id
    )
  );
end;
$function$;

-- 8. Accept one option: it becomes the appointment and the other is released.
-- p_actor_id null means the customer answered through the link.
create function valtrim.accept_customer_service_proposal(
  p_actor_id uuid,
  p_proposal_id bigint,
  p_option_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_via valtrim.service_response_channel :=
    case when p_actor_id is null then 'CUSTOMER_LINK' else 'COORDINATOR' end;
  v_option valtrim.service_proposal_options%rowtype;
  v_proposal valtrim.service_proposals%rowtype;
  v_request valtrim.service_requests%rowtype;
  v_time_zone text;
  v_day date;
  v_technician_id bigint;
  v_appointment_id bigint;
begin
  if p_actor_id is not null and not exists (
    select 1 from valtrim.app_users app_user
    where app_user.id = p_actor_id and app_user.is_active
      and app_user.role::text in ('ADMIN', 'SCHEDULING')
  ) then
    raise exception 'You do not have permission to record Customer Service proposal answers'
      using errcode = '42501';
  end if;

  select * into v_option from valtrim.service_proposal_options
  where id = p_option_id and proposal_id = p_proposal_id;
  if not found then
    raise exception 'This option is not part of the proposal' using errcode = 'P0002';
  end if;

  select settings.time_zone into strict v_time_zone
  from valtrim.service_scheduling_settings settings where settings.id = 1;
  v_day := (v_option.window_starts_at at time zone v_time_zone)::date;
  foreach v_technician_id in array v_option.technician_ids loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(format('service-appointments:%s:%s', v_technician_id, v_day), 0)
    );
  end loop;

  select * into v_proposal from valtrim.service_proposals where id = p_proposal_id for update;
  -- A repeated click on the same answer returns the first result.
  if v_proposal.status = 'ACCEPTED' and v_proposal.accepted_option_id = p_option_id then
    return jsonb_build_object(
      'proposalId', p_proposal_id, 'requestId', v_proposal.request_id, 'alreadyRecorded', true,
      'appointmentId', (select appointment.id from valtrim.service_appointments appointment
        where appointment.proposal_id = p_proposal_id)
    );
  end if;
  if v_proposal.status <> 'SENT' then
    raise exception 'This proposal was already answered or cancelled' using errcode = '55000';
  end if;
  if v_option.window_starts_at <= pg_catalog.now() then
    raise exception 'This day has already started or passed' using errcode = '55000';
  end if;

  select * into v_request from valtrim.service_requests where id = v_proposal.request_id for update;
  if v_request.workflow_stage not in ('READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT')
     or v_request.closed_at is not null then
    raise exception 'This request is no longer waiting for the customer' using errcode = '55000';
  end if;

  -- A customer's answer is not credited to the coordinator who sent the proposal.
  if v_via = 'CUSTOMER_LINK' then
    perform pg_catalog.set_config('valtrim.system_actor', 'on', true);
  end if;

  insert into valtrim.service_appointments (
    request_id, technician_ids, window_starts_at, window_ends_at, starts_at, ends_at,
    pickup_minutes, acceptance, accepted_via, proposal_id, state, is_current,
    confirmation_status, confirmed_at, created_by, updated_by
  ) values (
    v_proposal.request_id, v_option.technician_ids, v_option.window_starts_at, v_option.window_ends_at,
    v_option.starts_at, v_option.ends_at, v_option.pickup_minutes, 'CUSTOMER_ACCEPTED_PROPOSAL',
    v_via, p_proposal_id, 'SCHEDULED', true, 'CONFIRMED', pg_catalog.now(), p_actor_id, p_actor_id
  ) returning id into v_appointment_id;

  update valtrim.service_proposals
  set status = 'ACCEPTED', responded_at = pg_catalog.now(), response_via = v_via,
      accepted_option_id = p_option_id, updated_by = p_actor_id
  where id = p_proposal_id;

  update valtrim.service_requests
  set workflow_stage = 'CONFIRMED', updated_by = p_actor_id
  where id = v_proposal.request_id;

  perform pg_catalog.set_config('valtrim.system_actor', '', true);
  return jsonb_build_object(
    'proposalId', p_proposal_id, 'requestId', v_proposal.request_id,
    'appointmentId', v_appointment_id, 'alreadyRecorded', false
  );
end;
$function$;

-- 9. Reject (no dates) or counter-propose (one to three dates): the options are
-- released. A rejection goes to Needs contact; a counter-proposal goes back to
-- Ready to propose with the customer's dates.
create function valtrim.decline_customer_service_proposal(
  p_actor_id uuid,
  p_proposal_id bigint,
  p_counter_dates date[],
  p_counter_day_part text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_via valtrim.service_response_channel :=
    case when p_actor_id is null then 'CUSTOMER_LINK' else 'COORDINATOR' end;
  v_status valtrim.service_proposal_status :=
    case when p_counter_dates is null then 'REJECTED' else 'COUNTER_PROPOSED' end;
  v_note text := nullif(btrim(p_note), '');
  v_day_part valtrim.service_day_part;
  v_dates date[];
  v_today date;
  v_proposal valtrim.service_proposals%rowtype;
begin
  if p_actor_id is not null and not exists (
    select 1 from valtrim.app_users app_user
    where app_user.id = p_actor_id and app_user.is_active
      and app_user.role::text in ('ADMIN', 'SCHEDULING')
  ) then
    raise exception 'You do not have permission to record Customer Service proposal answers'
      using errcode = '42501';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'Keep the note to 1,000 characters or fewer' using errcode = '22023';
  end if;

  if v_status = 'COUNTER_PROPOSED' then
    select (now() at time zone settings.time_zone)::date into strict v_today
    from valtrim.service_scheduling_settings settings where settings.id = 1;
    select array_agg(distinct counter_date order by counter_date) into v_dates
    from unnest(p_counter_dates) counter_date;
    if v_dates is null or array_position(v_dates, null) is not null
       or cardinality(v_dates) <> cardinality(p_counter_dates)
       or cardinality(v_dates) > 3 or v_dates[1] < v_today then
      raise exception 'Choose one to three different dates from today on' using errcode = '22023';
    end if;
    begin
      v_day_part := nullif(btrim(p_counter_day_part), '')::valtrim.service_day_part;
    exception
      when invalid_text_representation then
        raise exception 'Choose morning, midday or afternoon' using errcode = '22023';
    end;
  elsif nullif(btrim(p_counter_day_part), '') is not null then
    raise exception 'A part of the day goes with counter-proposed dates' using errcode = '22023';
  end if;

  select * into v_proposal from valtrim.service_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'The proposal was not found' using errcode = 'P0002';
  end if;
  if v_proposal.status = v_status then
    return jsonb_build_object('proposalId', p_proposal_id, 'requestId', v_proposal.request_id,
      'status', v_status, 'alreadyRecorded', true);
  end if;
  if v_proposal.status <> 'SENT' then
    raise exception 'This proposal was already answered or cancelled' using errcode = '55000';
  end if;

  if v_via = 'CUSTOMER_LINK' then
    perform pg_catalog.set_config('valtrim.system_actor', 'on', true);
  end if;

  update valtrim.service_proposals
  set status = v_status, responded_at = pg_catalog.now(), response_via = v_via,
      counter_dates = v_dates, counter_day_part = v_day_part, customer_note = v_note,
      updated_by = p_actor_id
  where id = p_proposal_id;

  update valtrim.service_requests
  set workflow_stage = case when v_status = 'REJECTED' then 'NEEDS_CONTACT' else 'READY_TO_PROPOSE' end::valtrim.service_request_workflow_stage,
      updated_by = p_actor_id
  where id = v_proposal.request_id and workflow_stage = 'AWAITING_CUSTOMER';

  perform pg_catalog.set_config('valtrim.system_actor', '', true);
  return jsonb_build_object('proposalId', p_proposal_id, 'requestId', v_proposal.request_id,
    'status', v_status, 'alreadyRecorded', false);
end;
$function$;

-- 10. Cancel: no capacity rule, so the signed-in coordinator calls it directly
-- (also when the email could not be sent). Never automatic.
create function valtrim.cancel_customer_service_proposal(
  p_proposal_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_reason text := nullif(btrim(p_reason), '');
  v_proposal valtrim.service_proposals%rowtype;
begin
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a cancellation reason of 500 characters or fewer' using errcode = '22023';
  end if;

  select * into v_proposal from valtrim.service_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'The proposal was not found' using errcode = 'P0002';
  end if;
  if v_proposal.status <> 'SENT' then
    raise exception 'Only a proposal waiting for the customer can be cancelled' using errcode = '55000';
  end if;

  update valtrim.service_proposals
  set status = 'CANCELLED', cancelled_at = pg_catalog.now(), cancel_reason = v_reason,
      updated_by = v_actor_id
  where id = p_proposal_id;

  update valtrim.service_requests
  set workflow_stage = 'READY_TO_PROPOSE', updated_by = v_actor_id
  where id = v_proposal.request_id and workflow_stage = 'AWAITING_CUSTOMER';

  return jsonb_build_object('proposalId', p_proposal_id, 'requestId', v_proposal.request_id);
end;
$function$;

revoke all on function valtrim.send_customer_service_proposal(uuid, bigint, timestamptz, bigint[], bigint[], text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function valtrim.accept_customer_service_proposal(uuid, bigint, bigint)
  from public, anon, authenticated;
revoke all on function valtrim.decline_customer_service_proposal(uuid, bigint, date[], text, text)
  from public, anon, authenticated;
revoke all on function valtrim.cancel_customer_service_proposal(bigint, text)
  from public, anon, authenticated;
grant execute on function valtrim.send_customer_service_proposal(uuid, bigint, timestamptz, bigint[], bigint[], text, jsonb, jsonb)
  to service_role;
grant execute on function valtrim.accept_customer_service_proposal(uuid, bigint, bigint) to service_role;
grant execute on function valtrim.decline_customer_service_proposal(uuid, bigint, date[], text, text) to service_role;
grant execute on function valtrim.cancel_customer_service_proposal(bigint, text) to authenticated;

comment on function valtrim.send_customer_service_proposal(uuid, bigint, timestamptz, bigint[], bigint[], text, jsonb, jsonb) is
  'Service role only. Stores a proposal validated by an Edge Function, holds its options, saves manual travel and moves the request to AWAITING_CUSTOMER. Rejects a stale request or technician day with 40001.';
comment on function valtrim.accept_customer_service_proposal(uuid, bigint, bigint) is
  'Service role only. Turns one option of a SENT proposal into the appointment and confirms the request. A null actor means the customer answered through the link.';
comment on function valtrim.decline_customer_service_proposal(uuid, bigint, date[], text, text) is
  'Service role only. Records a rejection (request to NEEDS_CONTACT) or a counter-proposal of one to three dates (request to READY_TO_PROPOSE) and releases the options.';
comment on function valtrim.cancel_customer_service_proposal(bigint, text) is
  'ADMIN/SCHEDULING only. Cancels a SENT proposal with a reason, releases its options and returns the request to READY_TO_PROPOSE.';

notify pgrst, 'reload schema';
commit;
