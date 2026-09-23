-- Public Superintendent responses for Builder follow-up emails.
--
-- Email links carry a signed, non-guessable token. The public Edge Function
-- validates that signature before using these service-role-only RPCs. A GET
-- equivalent only reads a snapshot; every response is an explicit POST.
-- NOT_READY creates a review request and never changes the Production date.

begin;

alter table valtrim.builder_follow_up_states
  drop constraint if exists builder_follow_up_states_status_check;

alter table valtrim.builder_follow_up_states
  add constraint builder_follow_up_states_status_check
  check (status in (
    'SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'RESCHEDULE_REQUESTED',
    'NO_RESPONSE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'
  ));

alter table valtrim.builder_follow_up_events
  drop constraint if exists builder_follow_up_events_action_check;

alter table valtrim.builder_follow_up_events
  add constraint builder_follow_up_events_action_check
  check (action in (
    'EMAIL_SENT', 'CONFIRMED', 'SCHEDULED', 'RESCHEDULED',
    'NOT_READY', 'NO_RESPONSE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'
  ));

create table valtrim.builder_follow_up_response_tokens (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  outbox_id bigint not null unique
    references valtrim.builder_follow_up_emails(id) on delete cascade,
  checkpoint_id bigint not null
    references valtrim.builder_follow_up_checkpoints(id) on delete cascade,
  schedule_id bigint not null
    references valtrim.production_schedules(id) on delete cascade,
  target_work_date date not null,
  recipient_contact_id bigint not null
    references valtrim.builder_contacts(id) on delete restrict,
  recipient_name varchar(100) not null,
  recipient_email valtrim.email_address not null,
  expires_at timestamptz not null,
  responded_at timestamptz,
  response_action varchar(16)
    check (response_action is null or response_action in ('CONFIRMED', 'NOT_READY')),
  revoked_at timestamptz,
  revocation_reason varchar(80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (
    (responded_at is null and response_action is null)
    or (responded_at is not null and response_action is not null)
  )
);

create table valtrim.builder_follow_up_reschedule_requests (
  id bigint generated always as identity primary key,
  response_token_id bigint not null unique
    references valtrim.builder_follow_up_response_tokens(id) on delete restrict,
  schedule_id bigint not null
    references valtrim.production_schedules(id) on delete cascade,
  target_work_date date not null,
  proposed_work_date date not null,
  reason varchar(500),
  status varchar(16) not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  superintendent_contact_id bigint not null
    references valtrim.builder_contacts(id) on delete restrict,
  superintendent_name varchar(100) not null,
  superintendent_email valtrim.email_address not null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references valtrim.app_users(id) on delete set null,
  reviewed_at timestamptz,
  review_note varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposed_work_date > target_work_date),
  check (proposed_work_date <= target_work_date + 365),
  check (
    (status = 'PENDING' and reviewed_at is null and reviewed_by is null)
    or status <> 'PENDING'
  )
);

create unique index builder_follow_up_reschedule_requests_pending_idx
  on valtrim.builder_follow_up_reschedule_requests (schedule_id, target_work_date)
  where status = 'PENDING';
create index builder_follow_up_response_tokens_schedule_idx
  on valtrim.builder_follow_up_response_tokens (schedule_id, target_work_date);
create index builder_follow_up_response_tokens_checkpoint_idx
  on valtrim.builder_follow_up_response_tokens (checkpoint_id);
create index builder_follow_up_response_tokens_contact_idx
  on valtrim.builder_follow_up_response_tokens (recipient_contact_id);
create index builder_follow_up_response_tokens_expiry_idx
  on valtrim.builder_follow_up_response_tokens (expires_at)
  where responded_at is null and revoked_at is null;
create index builder_follow_up_reschedule_requests_schedule_idx
  on valtrim.builder_follow_up_reschedule_requests (schedule_id);
create index builder_follow_up_reschedule_requests_contact_idx
  on valtrim.builder_follow_up_reschedule_requests (superintendent_contact_id);
create index builder_follow_up_reschedule_requests_reviewed_by_idx
  on valtrim.builder_follow_up_reschedule_requests (reviewed_by)
  where reviewed_by is not null;

create trigger builder_follow_up_response_tokens_set_updated_at
before update on valtrim.builder_follow_up_response_tokens
for each row execute function valtrim.set_updated_at();

create trigger builder_follow_up_reschedule_requests_set_updated_at
before update on valtrim.builder_follow_up_reschedule_requests
for each row execute function valtrim.set_updated_at();

-- One public id is stable across retries of the same outbox row. The raw
-- signed token is never stored; the Edge Function signs public_id with its
-- FOLLOW_UP_RESPONSE_SECRET each time it renders the live email.
create function valtrim.issue_builder_follow_up_response_token(
  p_outbox_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_source record;
  v_token valtrim.builder_follow_up_response_tokens%rowtype;
begin
  if not v_is_service then
    raise exception 'Only the email service can issue a follow-up response token'
      using errcode = '42501';
  end if;

  select
    email.id as outbox_id,
    checkpoint.id as checkpoint_id,
    checkpoint.schedule_id,
    checkpoint.work_date,
    superintendent.id as recipient_contact_id,
    superintendent.name as recipient_name,
    superintendent.email as recipient_email
  into v_source
  from valtrim.builder_follow_up_emails email
  join valtrim.builder_follow_up_checkpoints checkpoint
    on checkpoint.id = email.checkpoint_id
   and checkpoint.status = 'PENDING'
  join valtrim.production_schedules schedule
    on schedule.id = checkpoint.schedule_id
   and schedule.is_active
   and schedule.scheduled_date = checkpoint.work_date
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.jobs job
    on job.id = activity.job_id
   and job.is_active
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
   and superintendent.is_active
  where email.id = p_outbox_id
    and email.status = 'PROCESSING'
  for update of email;

  if not found then
    raise exception 'The follow-up email is not eligible for a response link'
      using errcode = 'P0002';
  end if;

  insert into valtrim.builder_follow_up_response_tokens (
    outbox_id,
    checkpoint_id,
    schedule_id,
    target_work_date,
    recipient_contact_id,
    recipient_name,
    recipient_email,
    expires_at
  ) values (
    v_source.outbox_id,
    v_source.checkpoint_id,
    v_source.schedule_id,
    v_source.work_date,
    v_source.recipient_contact_id,
    v_source.recipient_name,
    v_source.recipient_email,
    ((v_source.work_date + 1)::timestamp at time zone 'UTC')
  )
  on conflict (outbox_id) do update
  set checkpoint_id = excluded.checkpoint_id,
      schedule_id = excluded.schedule_id,
      target_work_date = excluded.target_work_date,
      recipient_contact_id = excluded.recipient_contact_id,
      recipient_name = excluded.recipient_name,
      recipient_email = excluded.recipient_email,
      expires_at = excluded.expires_at
  where valtrim.builder_follow_up_response_tokens.responded_at is null
    and valtrim.builder_follow_up_response_tokens.revoked_at is null
  returning * into v_token;

  if v_token.id is null then
    raise exception 'The follow-up response link was already closed'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'publicId', v_token.public_id::text,
    'expiresAt', v_token.expires_at
  );
end;
$$;

create function valtrim.get_builder_follow_up_response(
  p_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_token valtrim.builder_follow_up_response_tokens%rowtype;
  v_source record;
  v_request valtrim.builder_follow_up_reschedule_requests%rowtype;
begin
  if not v_is_service then
    raise exception 'Only the response service can read a public follow-up response'
      using errcode = '42501';
  end if;

  select token.* into v_token
  from valtrim.builder_follow_up_response_tokens token
  where token.public_id = p_public_id;

  if not found then
    raise exception 'The follow-up response link is invalid'
      using errcode = 'P0002';
  end if;

  if v_token.responded_at is not null then
    select request.* into v_request
    from valtrim.builder_follow_up_reschedule_requests request
    where request.response_token_id = v_token.id;

    return jsonb_build_object(
      'alreadySubmitted', true,
      'responseAction', v_token.response_action,
      'respondedAt', v_token.responded_at,
      'workDate', v_token.target_work_date::text,
      'proposedWorkDate', v_request.proposed_work_date::text,
      'requestStatus', v_request.status,
      'recipientName', v_token.recipient_name
    );
  end if;

  if v_token.revoked_at is not null or v_token.expires_at <= now() then
    raise exception 'The follow-up response link is expired or no longer valid'
      using errcode = 'P0002';
  end if;

  select
    schedule.id as schedule_id,
    checkpoint.id as checkpoint_id,
    stage.stage_type,
    schedule.variant,
    schedule.scheduled_date as work_date,
    schedule.lot_start_label,
    schedule.lot_end_label,
    job.code as job_code,
    job.community,
    builder.name as builder_name,
    phase.code as phase_code,
    phase.building,
    superintendent.name as recipient_name
  into v_source
  from valtrim.production_schedules schedule
  join valtrim.builder_follow_up_checkpoints checkpoint
    on checkpoint.id = v_token.checkpoint_id
   and checkpoint.schedule_id = schedule.id
   and checkpoint.status in ('PENDING', 'COMPLETED')
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.jobs job
    on job.id = activity.job_id
   and job.is_active
  join valtrim.builders builder on builder.id = job.builder_id
  join valtrim.phases phase on phase.id = activity.phase_id
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.id = v_token.recipient_contact_id
   and superintendent.email = v_token.recipient_email
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
   and superintendent.is_active
  where schedule.id = v_token.schedule_id
    and schedule.is_active
    and schedule.scheduled_date = v_token.target_work_date;

  if not found then
    raise exception 'The Production date or designated Superintendent changed'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'alreadySubmitted', false,
    'scheduleId', v_source.schedule_id::text,
    'checkpointId', v_source.checkpoint_id::text,
    'stageType', v_source.stage_type::text,
    'variant', v_source.variant::text,
    'workDate', v_source.work_date::text,
    'minimumProposedDate', (v_source.work_date + 1)::text,
    'lotStartLabel', coalesce(v_source.lot_start_label, ''),
    'lotEndLabel', coalesce(v_source.lot_end_label, ''),
    'jobCode', v_source.job_code,
    'community', v_source.community,
    'builderName', v_source.builder_name,
    'phaseCode', v_source.phase_code,
    'building', coalesce(v_source.building, ''),
    'recipientName', v_source.recipient_name,
    'expiresAt', v_token.expires_at
  );
end;
$$;

create function valtrim.submit_builder_follow_up_response(
  p_public_id uuid,
  p_response text,
  p_proposed_work_date date default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_token valtrim.builder_follow_up_response_tokens%rowtype;
  v_source record;
  v_request_id bigint;
  v_response text := upper(btrim(coalesce(p_response, '')));
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not v_is_service then
    raise exception 'Only the response service can submit a public follow-up response'
      using errcode = '42501';
  end if;

  if v_response not in ('CONFIRMED', 'NOT_READY') then
    raise exception 'Select Confirmed or Not ready'
      using errcode = '22023';
  end if;

  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'The readiness note must contain 500 characters or fewer'
      using errcode = '22023';
  end if;

  select token.* into v_token
  from valtrim.builder_follow_up_response_tokens token
  where token.public_id = p_public_id
  for update;

  if not found then
    raise exception 'The follow-up response link is invalid'
      using errcode = 'P0002';
  end if;

  if v_token.responded_at is not null then
    if v_token.response_action <> v_response then
      raise exception 'A different response was already submitted with this link'
        using errcode = '23505';
    end if;

    select request.id into v_request_id
    from valtrim.builder_follow_up_reschedule_requests request
    where request.response_token_id = v_token.id;

    return jsonb_build_object(
      'alreadySubmitted', true,
      'responseAction', v_token.response_action,
      'respondedAt', v_token.responded_at,
      'workDate', v_token.target_work_date::text,
      'requestId', v_request_id::text
    );
  end if;

  if v_token.revoked_at is not null or v_token.expires_at <= now() then
    raise exception 'The follow-up response link is expired or no longer valid'
      using errcode = 'P0002';
  end if;

  select
    schedule.id as schedule_id,
    schedule.scheduled_date,
    state.status as follow_up_status,
    job.id as job_id,
    superintendent.id as contact_id,
    superintendent.name as contact_name,
    superintendent.email as contact_email
  into v_source
  from valtrim.production_schedules schedule
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.jobs job
    on job.id = activity.job_id
   and job.is_active
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.id = v_token.recipient_contact_id
   and superintendent.email = v_token.recipient_email
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
   and superintendent.is_active
  join valtrim.builder_follow_up_states state
    on state.schedule_id = schedule.id
  where schedule.id = v_token.schedule_id
    and schedule.is_active
    and schedule.scheduled_date = v_token.target_work_date
    and state.status not in (
      'CONFIRMED', 'RESCHEDULE_REQUESTED', 'ON_HOLD', 'COMPLETED', 'CANCELLED'
    )
  for update of schedule, state;

  if not found then
    raise exception 'The Production date, response state, or designated Superintendent changed'
      using errcode = 'P0002';
  end if;

  if v_response = 'NOT_READY' then
    if p_proposed_work_date is null
       or p_proposed_work_date <= v_token.target_work_date
       or p_proposed_work_date > v_token.target_work_date + 365 then
      raise exception 'Select a requested date after the current work date and within one year'
        using errcode = '22023';
    end if;

    insert into valtrim.builder_follow_up_reschedule_requests (
      response_token_id,
      schedule_id,
      target_work_date,
      proposed_work_date,
      reason,
      superintendent_contact_id,
      superintendent_name,
      superintendent_email
    ) values (
      v_token.id,
      v_token.schedule_id,
      v_token.target_work_date,
      p_proposed_work_date,
      v_reason,
      v_token.recipient_contact_id,
      v_token.recipient_name,
      v_token.recipient_email
    ) returning id into v_request_id;

    update valtrim.builder_follow_up_states state
    set status = 'RESCHEDULE_REQUESTED',
        confirmed_for_date = null,
        confirmed_at = null,
        last_response_at = now(),
        note = left(
          'Superintendent requested ' || p_proposed_work_date::text
            || case when v_reason is null then '' else ': ' || v_reason end,
          500
        ),
        updated_by = null
    where state.schedule_id = v_token.schedule_id;

    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = 'SKIPPED',
        resolution = 'RESCHEDULE_REQUESTED',
        completed_at = now(),
        completed_by = null
    where checkpoint.schedule_id = v_token.schedule_id
      and checkpoint.work_date = v_token.target_work_date
      and checkpoint.status = 'PENDING';
  else
    update valtrim.builder_follow_up_states state
    set status = 'CONFIRMED',
        confirmed_for_date = v_token.target_work_date,
        confirmed_at = now(),
        last_response_at = now(),
        note = 'Confirmed by the Jobsite Superintendent from the email response link.',
        updated_by = null
    where state.schedule_id = v_token.schedule_id;

    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = 'SKIPPED',
        resolution = 'CONFIRMED',
        completed_at = now(),
        completed_by = null
    where checkpoint.schedule_id = v_token.schedule_id
      and checkpoint.work_date = v_token.target_work_date
      and checkpoint.status = 'PENDING';
  end if;

  update valtrim.builder_follow_up_emails email
  set status = 'CANCELLED',
      last_error = case
        when v_response = 'CONFIRMED'
          then 'The Superintendent confirmed the work date.'
        else 'The Superintendent requested a different work date.'
      end
  from valtrim.builder_follow_up_checkpoints checkpoint
  where checkpoint.id = email.checkpoint_id
    and checkpoint.schedule_id = v_token.schedule_id
    and checkpoint.work_date = v_token.target_work_date
    and email.status in ('PROCESSING', 'FAILED');

  insert into valtrim.builder_follow_up_events (
    schedule_id,
    checkpoint_id,
    action,
    target_work_date,
    contact_id,
    contact_name,
    contact_email,
    communication_method,
    note
  ) values (
    v_token.schedule_id,
    v_token.checkpoint_id,
    case when v_response = 'CONFIRMED' then 'CONFIRMED' else 'NOT_READY' end,
    v_token.target_work_date,
    v_token.recipient_contact_id,
    v_token.recipient_name,
    v_token.recipient_email,
    'EMAIL',
    case
      when v_response = 'CONFIRMED'
        then 'Confirmed from the secure email response link.'
      else left(
        'Requested date ' || p_proposed_work_date::text
          || case when v_reason is null then '' else ': ' || v_reason end,
        500
      )
    end
  );

  update valtrim.builder_follow_up_response_tokens token
  set responded_at = now(),
      response_action = v_response
  where token.id = v_token.id;

  update valtrim.builder_follow_up_response_tokens token
  set revoked_at = now(),
      revocation_reason = 'RESPONSE_RECORDED'
  where token.schedule_id = v_token.schedule_id
    and token.target_work_date = v_token.target_work_date
    and token.id <> v_token.id
    and token.responded_at is null
    and token.revoked_at is null;

  perform private.refresh_builder_follow_up_checkpoints();
  perform private.refresh_builder_follow_up_escalations();

  return jsonb_build_object(
    'alreadySubmitted', false,
    'responseAction', v_response,
    'respondedAt', now(),
    'workDate', v_token.target_work_date::text,
    'proposedWorkDate', p_proposed_work_date::text,
    'requestId', v_request_id::text
  );
end;
$$;

create function valtrim.resolve_builder_follow_up_reschedule_request(
  p_request_id bigint,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_review_note text := nullif(btrim(p_review_note), '');
  v_request valtrim.builder_follow_up_reschedule_requests%rowtype;
  v_schedule record;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'PROJECT_MANAGEMENT',
       'SCHEDULING'
     )) then
    raise exception 'You do not have permission to review reschedule requests'
      using errcode = '42501';
  end if;

  if v_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'Select Approve or Keep current date'
      using errcode = '22023';
  end if;

  if v_review_note is not null and char_length(v_review_note) > 500 then
    raise exception 'The review note must contain 500 characters or fewer'
      using errcode = '22023';
  end if;

  select request.* into v_request
  from valtrim.builder_follow_up_reschedule_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'The reschedule request is unavailable'
      using errcode = 'P0002';
  end if;

  if v_request.status <> 'PENDING' then
    if v_request.status = v_decision then
      return jsonb_build_object(
        'requestId', v_request.id::text,
        'decision', v_request.status,
        'alreadyResolved', true
      );
    end if;
    raise exception 'The reschedule request was already resolved'
      using errcode = '23505';
  end if;

  select
    schedule.id,
    schedule.scheduled_date,
    superintendent.id as contact_id,
    superintendent.name as contact_name,
    superintendent.email as contact_email
  into v_schedule
  from valtrim.production_schedules schedule
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.jobs job
    on job.id = activity.job_id
   and job.is_active
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
  where schedule.id = v_request.schedule_id
    and schedule.is_active
  for update of schedule;

  if not found or v_schedule.scheduled_date <> v_request.target_work_date then
    raise exception 'The Production date changed before this request was reviewed'
      using errcode = 'P0002';
  end if;

  if v_decision = 'APPROVED' then
    if v_request.proposed_work_date < current_date then
      raise exception 'The requested date is now in the past'
        using errcode = '22023';
    end if;

    update valtrim.production_schedules schedule
    set scheduled_date = v_request.proposed_work_date,
        updated_by = v_actor_id
    where schedule.id = v_request.schedule_id;
  else
    update valtrim.builder_follow_up_states state
    set status = 'ON_HOLD',
        confirmed_for_date = null,
        confirmed_at = null,
        note = left(
          'Requested date was not approved; contact the Superintendent.'
            || case when v_review_note is null then '' else ' ' || v_review_note end,
          500
        ),
        updated_by = v_actor_id
    where state.schedule_id = v_request.schedule_id;

    insert into valtrim.builder_follow_up_events (
      schedule_id,
      action,
      target_work_date,
      contact_id,
      contact_name,
      contact_email,
      note,
      created_by
    ) values (
      v_request.schedule_id,
      'ON_HOLD',
      v_request.target_work_date,
      v_schedule.contact_id,
      v_schedule.contact_name,
      v_schedule.contact_email,
      left(
        'Requested date ' || v_request.proposed_work_date::text
          || ' was not approved.'
          || case when v_review_note is null then '' else ' ' || v_review_note end,
        500
      ),
      v_actor_id
    );
  end if;

  update valtrim.builder_follow_up_reschedule_requests request
  set status = v_decision,
      reviewed_by = v_actor_id,
      reviewed_at = now(),
      review_note = v_review_note
  where request.id = v_request.id;

  perform private.refresh_builder_follow_up_checkpoints();
  perform private.refresh_builder_follow_up_escalations();

  return jsonb_build_object(
    'requestId', v_request.id::text,
    'decision', v_decision,
    'alreadyResolved', false,
    'workDate', v_request.target_work_date::text,
    'proposedWorkDate', v_request.proposed_work_date::text
  );
end;
$$;

create view valtrim.builder_follow_up_reschedule_queue
with (security_invoker = true)
as
select
  request.id as request_id,
  request.schedule_id,
  request.target_work_date,
  schedule.scheduled_date as current_work_date,
  request.proposed_work_date,
  request.proposed_work_date - request.target_work_date as requested_shift_days,
  request.reason,
  request.status,
  request.submitted_at,
  request.superintendent_contact_id,
  request.superintendent_name,
  request.superintendent_email,
  stage.stage_type,
  schedule.variant,
  job.code as job_code,
  job.community,
  builder.name as builder_name,
  phase.code as phase_code,
  phase.building,
  schedule.lot_start_label,
  schedule.lot_end_label
from valtrim.builder_follow_up_reschedule_requests request
join valtrim.production_schedules schedule on schedule.id = request.schedule_id
join valtrim.production_stages stage on stage.id = schedule.stage_id
join valtrim.production_activities activity on activity.id = schedule.activity_id
join valtrim.jobs job on job.id = activity.job_id
join valtrim.builders builder on builder.id = job.builder_id
join valtrim.phases phase on phase.id = activity.phase_id;

alter table valtrim.builder_follow_up_response_tokens enable row level security;
alter table valtrim.builder_follow_up_reschedule_requests enable row level security;

create policy builder_follow_up_reschedule_requests_select
on valtrim.builder_follow_up_reschedule_requests for select to authenticated
using ((select private.is_active_user()));

revoke all on table valtrim.builder_follow_up_response_tokens,
  valtrim.builder_follow_up_reschedule_requests,
  valtrim.builder_follow_up_reschedule_queue
  from public, anon, authenticated;
revoke all on sequence valtrim.builder_follow_up_response_tokens_id_seq,
  valtrim.builder_follow_up_reschedule_requests_id_seq
  from public, anon, authenticated;
revoke execute on function valtrim.issue_builder_follow_up_response_token(bigint),
  valtrim.get_builder_follow_up_response(uuid),
  valtrim.submit_builder_follow_up_response(uuid, text, date, text),
  valtrim.resolve_builder_follow_up_reschedule_request(bigint, text, text)
  from public, anon, authenticated;

grant all on table valtrim.builder_follow_up_response_tokens,
  valtrim.builder_follow_up_reschedule_requests
  to service_role;
grant usage, select on sequence valtrim.builder_follow_up_response_tokens_id_seq,
  valtrim.builder_follow_up_reschedule_requests_id_seq
  to service_role;
grant select on table valtrim.builder_follow_up_reschedule_requests,
  valtrim.builder_follow_up_reschedule_queue
  to authenticated;
grant select on table valtrim.builder_follow_up_reschedule_queue
  to service_role;
grant execute on function valtrim.issue_builder_follow_up_response_token(bigint),
  valtrim.get_builder_follow_up_response(uuid),
  valtrim.submit_builder_follow_up_response(uuid, text, date, text)
  to service_role;
grant execute on function valtrim.resolve_builder_follow_up_reschedule_request(bigint, text, text)
  to authenticated, service_role;

comment on table valtrim.builder_follow_up_response_tokens is
  'Server-only lifecycle for signed Superintendent response links; raw signed tokens are never persisted.';
comment on table valtrim.builder_follow_up_reschedule_requests is
  'Superintendent-proposed dates awaiting an explicit ValTrim scheduling decision.';
comment on view valtrim.builder_follow_up_reschedule_queue is
  'Authenticated scheduling review queue for dates requested from follow-up emails.';
comment on function valtrim.submit_builder_follow_up_response(uuid, text, date, text) is
  'Service-only idempotent recording of explicit CONFIRMED or NOT_READY email responses.';

notify pgrst, 'reload schema';

commit;
