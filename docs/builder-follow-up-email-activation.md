# Builder follow-up email activation

The Production calendar remains the source of truth. Follow-up email delivery
is deployed in `PREVIEW` by default and cannot send until every live secret is
present and `FOLLOW_UP_EMAIL_MODE=LIVE`.

## Delivery prerequisites

1. Verify a sending domain in Resend.
2. Choose a real `From` identity on that domain.
3. Choose a monitored `Reply-To` mailbox. Replies from Jobsite
   Superintendents must reach a person; do not use a no-reply address.
4. Confirm the weekday/time and timezone for the scheduled run.

## Configure preview safely

Run from `apps/backend` without saving the values in source control:

```sh
supabase secrets set --project-ref dsernjmiaofkkddeisty \
  RESEND_API_KEY='re_...' \
  FOLLOW_UP_FROM_EMAIL='ValTrim Scheduling <scheduling@example.com>' \
  FOLLOW_UP_REPLY_TO='scheduler@example.com' \
  FOLLOW_UP_EMAIL_MODE='PREVIEW'
```

Open **Calendar → Builder follow-ups** and inspect the recipient, subject and
message for representative EXT, DM and HW checkpoints. Preview does not create
an outbox attempt and does not mark a checkpoint complete.

## Configure the scheduled caller

Generate one high-entropy value and store the same value in the Edge Function
and Supabase Vault. Do not commit or paste the value into SQL files.

```sh
openssl rand -hex 32
supabase secrets set --project-ref dsernjmiaofkkddeisty \
  FOLLOW_UP_CRON_SECRET='<generated value>'
```

In the Supabase SQL editor, create Vault secrets and the Cron job. Replace the
example schedule after confirming the delivery time. Supabase Cron uses UTC;
the example below runs at 13:00 UTC Monday through Friday.

```sql
select vault.create_secret(
  'https://dsernjmiaofkkddeisty.supabase.co',
  'builder_follow_up_project_url'
);

select vault.create_secret(
  '<the same generated value>',
  'builder_follow_up_cron_secret'
);

select cron.schedule(
  'builder-follow-up-email-weekdays',
  '0 13 * * 1-5',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'builder_follow_up_project_url'
    ) || '/functions/v1/builder-follow-up-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-valtrim-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'builder_follow_up_cron_secret'
      )
    ),
    body := '{"action":"send_due","limit":50}'::jsonb
  ) as request_id;
  $$
);
```

Keep the job in preview mode for its first scheduled invocation. Confirm in
Edge Function logs that the request was accepted and confirm that
`valtrim.builder_follow_up_emails` is still empty.

## Activate live delivery

Only after the preview review and scheduled-call test:

```sh
supabase secrets set --project-ref dsernjmiaofkkddeisty \
  FOLLOW_UP_EMAIL_MODE='LIVE'
```

The next due run will:

- resolve the current Job-designated Jobsite Superintendent;
- reject confirmed, on-hold, completed, cancelled or rescheduled work;
- skip obsolete catch-up checkpoints and work dates already in the past;
- acquire one durable outbox lease and Resend idempotency key;
- mark the checkpoint complete only after Resend accepts the message.

To stop delivery immediately without deleting data, set
`FOLLOW_UP_EMAIL_MODE=PREVIEW`. To remove the schedule, run:

```sql
select cron.unschedule('builder-follow-up-email-weekdays');
```

