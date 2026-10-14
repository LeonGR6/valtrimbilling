-- Phase 15: Builder follow-up checkpoints and a durable email outbox.
--
-- Standard reminders use calendar days. They are derived from the persisted
-- Production schedule, and the designated Jobsite Superintendent is resolved
-- from the current Job immediately before each send. Email delivery is handled
-- by an Edge Function; browser clients never write the outbox directly.

begin;

create table valtrim.builder_follow_up_rules (
  id bigint generated always as identity primary key,
  stage_type valtrim.production_stage_type not null,
  checkpoint_code varchar(40) not null
    check (checkpoint_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  days_before smallint not null check (days_before between 1 and 365),
  is_exception boolean not null default false,
  requires_approval boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_type, checkpoint_code),
  unique (stage_type, days_before, is_exception)
);

create table valtrim.builder_follow_up_states (
  schedule_id bigint primary key
    references valtrim.production_schedules(id) on delete cascade,
  status varchar(24) not null default 'SCHEDULED'
    check (status in (
      'SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'NO_RESPONSE',
      'ON_HOLD', 'COMPLETED', 'CANCELLED'
    )),
  confirmed_for_date date,
  confirmed_at timestamptz,
  last_response_at timestamptz,
  note varchar(500),
  updated_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'CONFIRMED' and confirmed_for_date is not null and confirmed_at is not null)
    or status <> 'CONFIRMED'
  )
);

create table valtrim.builder_follow_up_checkpoints (
  id bigint generated always as identity primary key,
  schedule_id bigint not null
    references valtrim.production_schedules(id) on delete cascade,
  rule_id bigint not null
    references valtrim.builder_follow_up_rules(id) on delete restrict,
  work_date date not null,
  due_on date not null,
  status varchar(16) not null default 'PENDING'
    check (status in ('PENDING', 'COMPLETED', 'SKIPPED', 'CANCELLED')),
  requires_approval boolean not null default false,
  resolution varchar(80),
  completed_at timestamptz,
  completed_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, rule_id, work_date),
  check (
    (status = 'PENDING' and completed_at is null)
    or (status <> 'PENDING' and completed_at is not null)
  )
);

create table valtrim.builder_follow_up_emails (
  id bigint generated always as identity primary key,
  checkpoint_id bigint not null unique
    references valtrim.builder_follow_up_checkpoints(id) on delete cascade,
  status varchar(16) not null
    check (status in ('PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  recipient_contact_id bigint
    references valtrim.builder_contacts(id) on delete set null,
  recipient_name varchar(100) not null,
  recipient_email valtrim.email_address not null,
  subject varchar(200),
  text_body text,
  html_body text,
  idempotency_key varchar(160) not null unique,
  provider_message_id varchar(200),
  attempt_count smallint not null default 1
    check (attempt_count between 1 and 20),
  processing_started_at timestamptz,
  sent_at timestamptz,
  last_error varchar(1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'SENT' and sent_at is not null and provider_message_id is not null)
    or status <> 'SENT'
  )
);

create table valtrim.builder_follow_up_events (
  id bigint generated always as identity primary key,
  schedule_id bigint not null
    references valtrim.production_schedules(id) on delete cascade,
  checkpoint_id bigint
    references valtrim.builder_follow_up_checkpoints(id) on delete set null,
  action varchar(32) not null
    check (action in (
      'EMAIL_SENT', 'CONFIRMED', 'SCHEDULED', 'RESCHEDULED',
      'NO_RESPONSE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'
    )),
  target_work_date date not null,
  contact_id bigint references valtrim.builder_contacts(id) on delete set null,
  contact_name varchar(100),
  contact_email valtrim.email_address,
  communication_method varchar(16)
    check (communication_method is null or communication_method in ('EMAIL', 'PHONE', 'TEXT', 'IN_PERSON')),
  provider_message_id varchar(200),
  note varchar(500),
  created_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index builder_follow_up_rules_active_idx
  on valtrim.builder_follow_up_rules (stage_type, days_before desc)
  where is_active;
create index builder_follow_up_states_status_idx
  on valtrim.builder_follow_up_states (status, schedule_id);
create index builder_follow_up_checkpoints_due_idx
  on valtrim.builder_follow_up_checkpoints (status, due_on, id);
create index builder_follow_up_checkpoints_schedule_idx
  on valtrim.builder_follow_up_checkpoints (schedule_id, work_date);
create index builder_follow_up_emails_status_idx
  on valtrim.builder_follow_up_emails (status, processing_started_at, id);
create index builder_follow_up_events_schedule_idx
  on valtrim.builder_follow_up_events (schedule_id, created_at desc, id desc);
create index builder_follow_up_states_updated_by_idx
  on valtrim.builder_follow_up_states (updated_by)
  where updated_by is not null;
create index builder_follow_up_checkpoints_completed_by_idx
  on valtrim.builder_follow_up_checkpoints (completed_by)
  where completed_by is not null;
create index builder_follow_up_events_created_by_idx
  on valtrim.builder_follow_up_events (created_by)
  where created_by is not null;

create trigger builder_follow_up_rules_set_updated_at
before update on valtrim.builder_follow_up_rules
for each row execute function valtrim.set_updated_at();

create trigger builder_follow_up_states_set_updated_at
before update on valtrim.builder_follow_up_states
for each row execute function valtrim.set_updated_at();

create trigger builder_follow_up_checkpoints_set_updated_at
before update on valtrim.builder_follow_up_checkpoints
for each row execute function valtrim.set_updated_at();

create trigger builder_follow_up_emails_set_updated_at
before update on valtrim.builder_follow_up_emails
for each row execute function valtrim.set_updated_at();

insert into valtrim.builder_follow_up_rules (
  stage_type,
  checkpoint_code,
  days_before
) values
  ('DM', 'EIGHT_WEEKS', 56),
  ('DM', 'FOUR_WEEKS', 28),
  ('DM', 'TWO_WEEKS', 14),
  ('DM', 'ONE_WEEK', 7),
  ('EXT', 'FOUR_WEEKS', 28),
  ('EXT', 'TWO_WEEKS', 14),
  ('EXT', 'ONE_WEEK', 7),
  ('HW', 'FOUR_WEEKS', 28),
  ('HW', 'TWO_WEEKS', 14),
  ('HW', 'ONE_WEEK', 7);

-- Rebuild the deterministic checkpoints from the current source-of-truth
-- schedule. This function is idempotent and never sends email.
create function private.refresh_builder_follow_up_checkpoints()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_affected integer := 0;
  v_count integer := 0;
begin
  if not v_is_service
     and not (select private.has_app_role(
       'ADMIN',
       'PROJECT_MANAGEMENT',
       'SCHEDULING'
     )) then
    raise exception 'You do not have permission to refresh Builder follow-ups'
      using errcode = '42501';
  end if;

  insert into valtrim.builder_follow_up_states (schedule_id, status)
  select
    schedule.id,
    'SCHEDULED'
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
   and stage.stage_type in ('EXT', 'DM', 'HW')
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  where schedule.is_active
  on conflict (schedule_id) do nothing;

  update valtrim.builder_follow_up_checkpoints checkpoint
  set status = 'CANCELLED',
      resolution = case
        when not rule.is_active then 'RULE_DISABLED'
        when schedule.id is null then 'SCHEDULE_UNAVAILABLE'
        when schedule.scheduled_date <> checkpoint.work_date then 'WORK_DATE_CHANGED'
        when state.status = 'CONFIRMED'
             and state.confirmed_for_date = checkpoint.work_date then 'CONFIRMED'
        else state.status
      end,
      completed_at = now()
  from valtrim.builder_follow_up_rules rule,
    valtrim.production_schedules schedule,
    valtrim.production_stages stage,
    valtrim.production_activities activity,
    valtrim.builder_follow_up_states state
  where checkpoint.rule_id = rule.id
    and schedule.id = checkpoint.schedule_id
    and stage.id = schedule.stage_id
    and activity.id = schedule.activity_id
    and state.schedule_id = checkpoint.schedule_id
    and checkpoint.status = 'PENDING'
    and (
      not rule.is_active
      or not schedule.is_active
      or not stage.is_enabled
      or activity.status <> 'ACTIVE'
      or schedule.scheduled_date <> checkpoint.work_date
      or (state.status = 'CONFIRMED' and state.confirmed_for_date = checkpoint.work_date)
      or state.status in ('ON_HOLD', 'COMPLETED', 'CANCELLED')
    );
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  update valtrim.builder_follow_up_emails email
  set status = 'CANCELLED',
      last_error = coalesce(email.last_error, 'The source follow-up checkpoint was cancelled.')
  from valtrim.builder_follow_up_checkpoints checkpoint
  where checkpoint.id = email.checkpoint_id
    and checkpoint.status = 'CANCELLED'
    and email.status in ('PROCESSING', 'FAILED');

  insert into valtrim.builder_follow_up_checkpoints (
    schedule_id,
    rule_id,
    work_date,
    due_on,
    requires_approval
  )
  select
    schedule.id,
    rule.id,
    schedule.scheduled_date,
    schedule.scheduled_date - rule.days_before,
    rule.requires_approval
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.builder_follow_up_rules rule
    on rule.stage_type = stage.stage_type
   and rule.is_active
   and not rule.is_exception
  join valtrim.builder_follow_up_states state
    on state.schedule_id = schedule.id
  where schedule.is_active
    and state.status not in ('ON_HOLD', 'COMPLETED', 'CANCELLED')
    and not (
      state.status = 'CONFIRMED'
      and state.confirmed_for_date = schedule.scheduled_date
    )
  on conflict (schedule_id, rule_id, work_date) do update
  set due_on = excluded.due_on,
      requires_approval = excluded.requires_approval
  where valtrim.builder_follow_up_checkpoints.status = 'PENDING';
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  return v_affected;
end;
$$;

create function valtrim.refresh_builder_follow_up_checkpoints()
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.refresh_builder_follow_up_checkpoints();
$$;

-- A response is separate from an outbound email. CONFIRMED is bound to the
-- exact current work date so a later reschedule automatically invalidates it.
create function private.record_builder_follow_up_status(
  p_schedule_id bigint,
  p_status text,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_work_date date;
  v_contact_id bigint;
  v_contact_name text;
  v_contact_email valtrim.email_address;
  v_event_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'PROJECT_MANAGEMENT',
       'SCHEDULING'
     )) then
    raise exception 'You do not have permission to record Builder follow-up status'
      using errcode = '42501';
  end if;

  if p_status is null
     or p_status not in (
       'SCHEDULED', 'CONFIRMED', 'NO_RESPONSE',
       'ON_HOLD', 'COMPLETED', 'CANCELLED'
     ) then
    raise exception 'Select a supported Builder follow-up status'
      using errcode = '23514';
  end if;

  if p_note is not null and char_length(btrim(p_note)) > 500 then
    raise exception 'Builder follow-up notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  select
    schedule.scheduled_date,
    superintendent.id,
    superintendent.name,
    superintendent.email
  into
    v_work_date,
    v_contact_id,
    v_contact_name,
    v_contact_email
  from valtrim.production_schedules schedule
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
  join valtrim.jobs job on job.id = activity.job_id
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
  where schedule.id = p_schedule_id
    and schedule.is_active
    and activity.status = 'ACTIVE'
    and job.is_active
  for update of schedule;

  if v_work_date is null then
    raise exception 'The Production schedule or designated Superintendent is unavailable'
      using errcode = 'P0002';
  end if;

  insert into valtrim.builder_follow_up_states (
    schedule_id,
    status,
    confirmed_for_date,
    confirmed_at,
    last_response_at,
    note,
    updated_by
  ) values (
    p_schedule_id,
    p_status,
    case when p_status = 'CONFIRMED' then v_work_date else null end,
    case when p_status = 'CONFIRMED' then now() else null end,
    case when p_status in ('CONFIRMED', 'NO_RESPONSE') then now() else null end,
    nullif(btrim(p_note), ''),
    v_actor_id
  )
  on conflict (schedule_id) do update
  set status = excluded.status,
      confirmed_for_date = excluded.confirmed_for_date,
      confirmed_at = excluded.confirmed_at,
      last_response_at = coalesce(
        excluded.last_response_at,
        valtrim.builder_follow_up_states.last_response_at
      ),
      note = excluded.note,
      updated_by = excluded.updated_by;

  if p_status in ('CONFIRMED', 'ON_HOLD', 'COMPLETED', 'CANCELLED') then
    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = case when p_status = 'CONFIRMED' then 'SKIPPED' else 'CANCELLED' end,
        resolution = p_status,
        completed_at = now(),
        completed_by = v_actor_id
    where checkpoint.schedule_id = p_schedule_id
      and checkpoint.work_date = v_work_date
      and checkpoint.status = 'PENDING';

    update valtrim.builder_follow_up_emails email
    set status = 'CANCELLED',
        last_error = 'The follow-up was closed as ' || p_status || '.'
    from valtrim.builder_follow_up_checkpoints checkpoint
    where checkpoint.id = email.checkpoint_id
      and checkpoint.schedule_id = p_schedule_id
      and checkpoint.work_date = v_work_date
      and email.status in ('PROCESSING', 'FAILED');
  elsif p_status = 'SCHEDULED' then
    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = 'PENDING',
        resolution = null,
        completed_at = null,
        completed_by = null
    where checkpoint.schedule_id = p_schedule_id
      and checkpoint.work_date = v_work_date
      and checkpoint.status = 'SKIPPED'
      and checkpoint.resolution = 'CONFIRMED';
  end if;

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
    p_schedule_id,
    p_status,
    v_work_date,
    v_contact_id,
    v_contact_name,
    v_contact_email,
    nullif(btrim(p_note), ''),
    v_actor_id
  ) returning id into v_event_id;

  perform private.refresh_builder_follow_up_checkpoints();
  return v_event_id;
end;
$$;

create function valtrim.record_builder_follow_up_status(
  p_schedule_id bigint,
  p_status text,
  p_note text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.record_builder_follow_up_status(
    p_schedule_id,
    p_status,
    p_note
  );
$$;

-- A schedule date change invalidates the old confirmation and the unsent
-- checkpoints for that prior date. A fresh matrix is created on refresh.
create function private.invalidate_builder_follow_up_on_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scheduled_date is distinct from old.scheduled_date then
    insert into valtrim.builder_follow_up_states (
      schedule_id,
      status,
      note,
      updated_by
    ) values (
      new.id,
      'RESCHEDULED',
      'Confirmation invalidated because the Production date changed.',
      new.updated_by
    )
    on conflict (schedule_id) do update
    set status = 'RESCHEDULED',
        confirmed_for_date = null,
        confirmed_at = null,
        note = excluded.note,
        updated_by = excluded.updated_by;

    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = 'CANCELLED',
        resolution = 'WORK_DATE_CHANGED',
        completed_at = now(),
        completed_by = new.updated_by
    where checkpoint.schedule_id = new.id
      and checkpoint.work_date = old.scheduled_date
      and checkpoint.status = 'PENDING';

    update valtrim.builder_follow_up_emails email
    set status = 'CANCELLED',
        last_error = 'The Production work date changed before this email was sent.'
    from valtrim.builder_follow_up_checkpoints checkpoint
    where checkpoint.id = email.checkpoint_id
      and checkpoint.schedule_id = new.id
      and checkpoint.work_date = old.scheduled_date
      and email.status in ('PROCESSING', 'FAILED');

    insert into valtrim.builder_follow_up_events (
      schedule_id,
      action,
      target_work_date,
      note,
      created_by
    ) values (
      new.id,
      'RESCHEDULED',
      new.scheduled_date,
      'Work date changed from ' || old.scheduled_date::text
        || ' to ' || new.scheduled_date::text || '.',
      new.updated_by
    );
  end if;

  return new;
end;
$$;

create trigger production_schedules_invalidate_builder_follow_up
after update of scheduled_date on valtrim.production_schedules
for each row execute function private.invalidate_builder_follow_up_on_schedule_change();

-- Service-role-only snapshot/lease. Preview mode is read-only. Live mode
-- creates or reacquires one durable outbox row with a stable idempotency key.
create function valtrim.prepare_builder_follow_up_email(
  p_checkpoint_id bigint,
  p_preview boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkpoint record;
  v_outbox valtrim.builder_follow_up_emails%rowtype;
  v_idempotency_key text;
begin
  perform private.refresh_builder_follow_up_checkpoints();

  select
    checkpoint.id as checkpoint_id,
    checkpoint.work_date,
    checkpoint.due_on,
    checkpoint.status as checkpoint_status,
    checkpoint.requires_approval,
    schedule.id as schedule_id,
    schedule.variant,
    stage.stage_type,
    activity.id as activity_id,
    job.code as job_code,
    job.community,
    builder.name as builder_name,
    phase.code as phase_code,
    phase.building,
    schedule.lot_start_label,
    schedule.lot_end_label,
    superintendent.id as recipient_contact_id,
    superintendent.name as recipient_name,
    superintendent.email as recipient_email,
    superintendent.is_active as recipient_is_active,
    state.status as follow_up_status,
    state.confirmed_for_date,
    rule.checkpoint_code,
    rule.days_before
  into v_checkpoint
  from valtrim.builder_follow_up_checkpoints checkpoint
  join valtrim.builder_follow_up_rules rule
    on rule.id = checkpoint.rule_id
   and rule.is_active
  join valtrim.production_schedules schedule
    on schedule.id = checkpoint.schedule_id
   and schedule.is_active
   and schedule.scheduled_date = checkpoint.work_date
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
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
  join valtrim.builder_follow_up_states state
    on state.schedule_id = schedule.id
  where checkpoint.id = p_checkpoint_id
  for update of checkpoint;

  if not found then
    raise exception 'The Builder follow-up checkpoint is unavailable'
      using errcode = 'P0002';
  end if;

  if v_checkpoint.checkpoint_status <> 'PENDING'
     or v_checkpoint.requires_approval
     or not v_checkpoint.recipient_is_active
     or v_checkpoint.follow_up_status in ('ON_HOLD', 'COMPLETED', 'CANCELLED')
     or (
       v_checkpoint.follow_up_status = 'CONFIRMED'
       and v_checkpoint.confirmed_for_date = v_checkpoint.work_date
     ) then
    raise exception 'The Builder follow-up checkpoint is not eligible for email'
      using errcode = 'P0002';
  end if;

  if not p_preview and v_checkpoint.due_on > current_date then
    raise exception 'The Builder follow-up checkpoint is not due yet'
      using errcode = '22023';
  end if;

  v_idempotency_key := 'valtrim-follow-up-'
    || v_checkpoint.checkpoint_id::text || '-' || v_checkpoint.work_date::text;

  if not p_preview then
    select email.* into v_outbox
    from valtrim.builder_follow_up_emails email
    where email.checkpoint_id = v_checkpoint.checkpoint_id
    for update;

    if v_outbox.status = 'SENT' then
      return jsonb_build_object(
        'alreadySent', true,
        'outboxId', v_outbox.id::text,
        'providerMessageId', v_outbox.provider_message_id
      );
    end if;

    if v_outbox.status = 'PROCESSING'
       and v_outbox.processing_started_at > now() - interval '15 minutes' then
      raise exception 'This Builder follow-up email is already being processed'
        using errcode = '55P03';
    end if;

    if v_outbox.id is null then
      insert into valtrim.builder_follow_up_emails (
        checkpoint_id,
        status,
        recipient_contact_id,
        recipient_name,
        recipient_email,
        idempotency_key,
        processing_started_at
      ) values (
        v_checkpoint.checkpoint_id,
        'PROCESSING',
        v_checkpoint.recipient_contact_id,
        v_checkpoint.recipient_name,
        v_checkpoint.recipient_email,
        v_idempotency_key,
        now()
      ) returning * into v_outbox;
    else
      update valtrim.builder_follow_up_emails email
      set status = 'PROCESSING',
          recipient_contact_id = v_checkpoint.recipient_contact_id,
          recipient_name = v_checkpoint.recipient_name,
          recipient_email = v_checkpoint.recipient_email,
          attempt_count = least(email.attempt_count + 1, 20),
          processing_started_at = now(),
          last_error = null
      where email.id = v_outbox.id
      returning * into v_outbox;
    end if;
  end if;

  return jsonb_build_object(
    'alreadySent', false,
    'outboxId', case when p_preview then null else v_outbox.id::text end,
    'idempotencyKey', v_idempotency_key,
    'checkpointId', v_checkpoint.checkpoint_id::text,
    'scheduleId', v_checkpoint.schedule_id::text,
    'activityId', v_checkpoint.activity_id::text,
    'checkpointCode', v_checkpoint.checkpoint_code,
    'daysBefore', v_checkpoint.days_before,
    'dueOn', v_checkpoint.due_on::text,
    'workDate', v_checkpoint.work_date::text,
    'stageType', v_checkpoint.stage_type::text,
    'variant', v_checkpoint.variant::text,
    'jobCode', v_checkpoint.job_code,
    'community', v_checkpoint.community,
    'builderName', v_checkpoint.builder_name,
    'phaseCode', v_checkpoint.phase_code,
    'building', coalesce(v_checkpoint.building, ''),
    'lotStartLabel', coalesce(v_checkpoint.lot_start_label, ''),
    'lotEndLabel', coalesce(v_checkpoint.lot_end_label, ''),
    'recipientContactId', v_checkpoint.recipient_contact_id::text,
    'recipientName', v_checkpoint.recipient_name,
    'recipientEmail', v_checkpoint.recipient_email::text
  );
end;
$$;

create function valtrim.finish_builder_follow_up_email(
  p_outbox_id bigint,
  p_success boolean,
  p_subject text,
  p_text_body text,
  p_html_body text,
  p_provider_message_id text default null,
  p_last_error text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finished_at timestamptz := now();
  v_email record;
begin
  if p_outbox_id is null
     or p_success is null
     or nullif(btrim(p_subject), '') is null
     or char_length(p_subject) > 200
     or nullif(btrim(p_text_body), '') is null
     or nullif(btrim(p_html_body), '') is null
     or char_length(coalesce(p_last_error, '')) > 1000
     or (
       p_success
       and nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     ) then
    raise exception 'The Builder follow-up email result is invalid'
      using errcode = '22023';
  end if;

  select email.* into v_email
  from valtrim.builder_follow_up_emails email
  where email.id = p_outbox_id
  for update;

  if v_email.id is null then
    raise exception 'The Builder follow-up outbox item is unavailable'
      using errcode = 'P0002';
  end if;

  if v_email.status = 'SENT' then
    return v_email.sent_at;
  end if;

  if v_email.status <> 'PROCESSING' then
    raise exception 'The Builder follow-up outbox item is not processing'
      using errcode = '22023';
  end if;

  update valtrim.builder_follow_up_emails email
  set status = case when p_success then 'SENT' else 'FAILED' end,
      subject = p_subject,
      text_body = p_text_body,
      html_body = p_html_body,
      provider_message_id = case
        when p_success then btrim(p_provider_message_id)
        else null
      end,
      sent_at = case when p_success then v_finished_at else null end,
      last_error = case
        when p_success then null
        else coalesce(nullif(btrim(p_last_error), ''), 'Email provider request failed.')
      end
  where email.id = p_outbox_id;

  if p_success then
    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = 'COMPLETED',
        resolution = 'EMAIL_SENT',
        completed_at = v_finished_at
    where checkpoint.id = v_email.checkpoint_id
      and checkpoint.status = 'PENDING';

    insert into valtrim.builder_follow_up_events (
      schedule_id,
      checkpoint_id,
      action,
      target_work_date,
      contact_id,
      contact_name,
      contact_email,
      communication_method,
      provider_message_id,
      note
    )
    select
      checkpoint.schedule_id,
      checkpoint.id,
      'EMAIL_SENT',
      checkpoint.work_date,
      v_email.recipient_contact_id,
      v_email.recipient_name,
      v_email.recipient_email,
      'EMAIL',
      btrim(p_provider_message_id),
      'Scheduled Builder follow-up email sent.'
    from valtrim.builder_follow_up_checkpoints checkpoint
    where checkpoint.id = v_email.checkpoint_id
      and not exists (
        select 1
        from valtrim.builder_follow_up_events event
        where event.checkpoint_id = checkpoint.id
          and event.action = 'EMAIL_SENT'
      );
  end if;

  return v_finished_at;
end;
$$;

create view valtrim.builder_follow_up_queue
with (security_invoker = true)
as
select
  checkpoint.id as checkpoint_id,
  schedule.id as schedule_id,
  activity.id as activity_id,
  rule.checkpoint_code,
  rule.days_before,
  stage.stage_type,
  schedule.variant,
  checkpoint.work_date,
  checkpoint.due_on,
  checkpoint.status as checkpoint_status,
  state.status as follow_up_status,
  state.confirmed_for_date,
  job.code as job_code,
  job.community,
  builder.name as builder_name,
  phase.code as phase_code,
  phase.building,
  schedule.lot_start_label,
  schedule.lot_end_label,
  superintendent.id as recipient_contact_id,
  superintendent.name as recipient_name,
  superintendent.email as recipient_email,
  superintendent.is_active as recipient_is_active,
  email.status as email_status,
  email.sent_at,
  email.last_error,
  case
    when checkpoint.status <> 'PENDING' then checkpoint.status
    when email.status = 'PROCESSING' then 'PROCESSING'
    when email.status = 'FAILED' then 'FAILED'
    when checkpoint.due_on < current_date then 'OVERDUE'
    when checkpoint.due_on = current_date then 'DUE'
    else 'UPCOMING'
  end as delivery_status,
  checkpoint.due_on - current_date as days_until_due
from valtrim.builder_follow_up_checkpoints checkpoint
join valtrim.builder_follow_up_rules rule on rule.id = checkpoint.rule_id
join valtrim.production_schedules schedule on schedule.id = checkpoint.schedule_id
join valtrim.production_stages stage on stage.id = schedule.stage_id
join valtrim.production_activities activity on activity.id = schedule.activity_id
join valtrim.jobs job on job.id = activity.job_id
join valtrim.builders builder on builder.id = job.builder_id
join valtrim.phases phase on phase.id = activity.phase_id
join valtrim.builder_contacts superintendent
  on superintendent.id = job.superintendent_id
 and superintendent.builder_id = job.builder_id
 and superintendent.type = 'JOBSITE_SUPERINTENDENT'
join valtrim.builder_follow_up_states state on state.schedule_id = schedule.id
left join valtrim.builder_follow_up_emails email
  on email.checkpoint_id = checkpoint.id;

alter table valtrim.builder_follow_up_rules enable row level security;
alter table valtrim.builder_follow_up_states enable row level security;
alter table valtrim.builder_follow_up_checkpoints enable row level security;
alter table valtrim.builder_follow_up_emails enable row level security;
alter table valtrim.builder_follow_up_events enable row level security;

create policy builder_follow_up_rules_select
on valtrim.builder_follow_up_rules for select to authenticated
using ((select private.is_active_user()));

create policy builder_follow_up_states_select
on valtrim.builder_follow_up_states for select to authenticated
using ((select private.is_active_user()));

create policy builder_follow_up_checkpoints_select
on valtrim.builder_follow_up_checkpoints for select to authenticated
using ((select private.is_active_user()));

create policy builder_follow_up_emails_select
on valtrim.builder_follow_up_emails for select to authenticated
using ((select private.is_active_user()));

create policy builder_follow_up_events_select
on valtrim.builder_follow_up_events for select to authenticated
using ((select private.is_active_user()));

revoke all on table valtrim.builder_follow_up_rules,
  valtrim.builder_follow_up_states,
  valtrim.builder_follow_up_checkpoints,
  valtrim.builder_follow_up_emails,
  valtrim.builder_follow_up_events
  from public, anon, authenticated;
revoke all on table valtrim.builder_follow_up_queue
  from public, anon, authenticated;

revoke all on sequence valtrim.builder_follow_up_rules_id_seq,
  valtrim.builder_follow_up_checkpoints_id_seq,
  valtrim.builder_follow_up_emails_id_seq,
  valtrim.builder_follow_up_events_id_seq
  from public, anon, authenticated;

revoke execute on function private.refresh_builder_follow_up_checkpoints()
  from public, anon, authenticated;
revoke execute on function valtrim.refresh_builder_follow_up_checkpoints()
  from public, anon, authenticated;
revoke execute on function private.record_builder_follow_up_status(bigint, text, text)
  from public, anon, authenticated;
revoke execute on function valtrim.record_builder_follow_up_status(bigint, text, text)
  from public, anon, authenticated;
revoke execute on function private.invalidate_builder_follow_up_on_schedule_change()
  from public, anon, authenticated;
revoke execute on function valtrim.prepare_builder_follow_up_email(bigint, boolean)
  from public, anon, authenticated;
revoke execute on function valtrim.finish_builder_follow_up_email(
  bigint, boolean, text, text, text, text, text
) from public, anon, authenticated;

grant select on table valtrim.builder_follow_up_rules,
  valtrim.builder_follow_up_states,
  valtrim.builder_follow_up_checkpoints,
  valtrim.builder_follow_up_emails,
  valtrim.builder_follow_up_events,
  valtrim.builder_follow_up_queue
  to authenticated;

grant execute on function private.refresh_builder_follow_up_checkpoints()
  to authenticated, service_role;
grant execute on function valtrim.refresh_builder_follow_up_checkpoints()
  to authenticated, service_role;
grant execute on function private.record_builder_follow_up_status(bigint, text, text)
  to authenticated, service_role;
grant execute on function valtrim.record_builder_follow_up_status(bigint, text, text)
  to authenticated, service_role;

grant all on table valtrim.builder_follow_up_rules,
  valtrim.builder_follow_up_states,
  valtrim.builder_follow_up_checkpoints,
  valtrim.builder_follow_up_emails,
  valtrim.builder_follow_up_events
  to service_role;
grant select on table valtrim.builder_follow_up_queue to service_role;
grant usage, select on sequence valtrim.builder_follow_up_rules_id_seq,
  valtrim.builder_follow_up_checkpoints_id_seq,
  valtrim.builder_follow_up_emails_id_seq,
  valtrim.builder_follow_up_events_id_seq
  to service_role;
grant execute on function valtrim.prepare_builder_follow_up_email(bigint, boolean)
  to service_role;
grant execute on function valtrim.finish_builder_follow_up_email(
  bigint, boolean, text, text, text, text, text
) to service_role;

comment on table valtrim.builder_follow_up_rules is
  'Production follow-up matrix. Standard rows use calendar-day offsets; exception rows are reserved for later approval-based business-day rules.';
comment on table valtrim.builder_follow_up_emails is
  'Server-written durable email outbox with one idempotent delivery per follow-up checkpoint.';
comment on view valtrim.builder_follow_up_queue is
  'Current Builder follow-up workload resolved to the Job designated Jobsite Superintendent.';
comment on function valtrim.prepare_builder_follow_up_email(bigint, boolean) is
  'Service-role-only validation, snapshot and lease for one Builder follow-up email.';

notify pgrst, 'reload schema';

commit;
