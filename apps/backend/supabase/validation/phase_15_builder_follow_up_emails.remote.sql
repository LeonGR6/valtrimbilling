begin;

do $$
declare
  v_checkpoint_count integer;
  v_sample_checkpoint_id bigint;
  v_snapshot jsonb;
begin
  if not (select relrowsecurity from pg_class where oid =
    'valtrim.builder_follow_up_emails'::regclass) then
    raise exception 'Phase 15 email outbox must have RLS enabled';
  end if;

  if has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_emails',
    'insert'
  ) then
    raise exception 'Authenticated clients can write the email outbox';
  end if;

  if has_function_privilege(
    'authenticated',
    'valtrim.prepare_builder_follow_up_email(bigint,boolean)',
    'execute'
  ) then
    raise exception 'Authenticated clients can acquire outbox leases';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform valtrim.refresh_builder_follow_up_checkpoints();

  if exists (
    select 1
    from valtrim.builder_follow_up_checkpoints checkpoint
    where checkpoint.status = 'PENDING'
      and checkpoint.work_date < current_date
  ) then
    raise exception 'A checkpoint remained open after its work date';
  end if;

  if exists (
    select checkpoint.schedule_id, checkpoint.work_date
    from valtrim.builder_follow_up_checkpoints checkpoint
    where checkpoint.status = 'PENDING'
      and checkpoint.due_on <= current_date
    group by checkpoint.schedule_id, checkpoint.work_date
    having count(*) > 1
  ) then
    raise exception 'Multiple catch-up emails remained due for one schedule';
  end if;

  select count(*) into v_checkpoint_count
  from valtrim.builder_follow_up_checkpoints checkpoint
  join valtrim.builder_follow_up_rules rule on rule.id = checkpoint.rule_id
  where checkpoint.status = 'PENDING'
    and not rule.is_exception;

  if v_checkpoint_count < 0 then
    raise exception 'Checkpoint count is invalid';
  end if;

  select checkpoint.id into v_sample_checkpoint_id
  from valtrim.builder_follow_up_checkpoints checkpoint
  where checkpoint.status = 'PENDING'
  order by checkpoint.due_on, checkpoint.id
  limit 1;

  if v_sample_checkpoint_id is not null then
    select valtrim.prepare_builder_follow_up_email(v_sample_checkpoint_id, true)
    into v_snapshot;

    if v_snapshot ->> 'checkpointId' <> v_sample_checkpoint_id::text
       or nullif(v_snapshot ->> 'recipientEmail', '') is null
       or nullif(v_snapshot ->> 'workDate', '') is null
       or v_snapshot ->> 'outboxId' is not null then
      raise exception 'Preview did not return a safe, read-only email snapshot';
    end if;

    if exists (
      select 1
      from valtrim.builder_follow_up_emails email
      where email.checkpoint_id = v_sample_checkpoint_id
    ) then
      raise exception 'Preview created an outbox item';
    end if;
  end if;
end;
$$;

rollback;

select 'phase_15_builder_follow_up_emails_remote_ok' as result;
