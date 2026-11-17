# Builder follow-up email activation

The Production calendar remains the source of truth. Follow-up email delivery
is deployed in `PREVIEW` by default and cannot send until every live secret is
present and `FOLLOW_UP_EMAIL_MODE=LIVE`.

The same delivery function also handles internal no-response escalations. When
an operator records **No response**, ValtrimBilling immediately shows the Job
under **Needs attention**. If it remains unresolved for two weekdays, one
idempotent internal email becomes due. The default recipient is
`andres@valtrim.com`; an Administrator can change the recipients, wait period,
or enablement from **Calendar → Builder follow-ups → Escalation settings**.

Each Superintendent email also contains **Confirmed** and **Not ready / Choose
a new date** buttons. They open the public `/follow-up/respond` page. Opening
the page is read-only; the response is recorded only after the Superintendent
submits it. **Confirmed** binds the confirmation to the current date.
**Not ready** immediately changes the official Production date to the selected
date, writes the date history, rebuilds follow-up checkpoints, and does not
require an internal approval.

## Delivery prerequisites

1. Verify a sending domain in Resend.
2. Choose a real `From` identity on that domain.
3. Choose a monitored `Reply-To` mailbox. Replies from Jobsite
   Superintendents must reach a person; do not use a no-reply address.
4. Confirm the weekday/time and timezone for the scheduled run.
5. Deploy the frontend at a stable HTTPS origin that can serve
   `/follow-up/respond` without requiring a ValtrimBilling login.

## Configure preview safely

Run from `apps/backend` without saving the values in source control:

```sh
supabase secrets set --project-ref dsernjmiaofkkddeisty \
  RESEND_API_KEY='re_...' \
  FOLLOW_UP_FROM_EMAIL='ValTrim Scheduling <scheduling@example.com>' \
  FOLLOW_UP_REPLY_TO='scheduler@example.com' \
  FOLLOW_UP_PUBLIC_APP_URL='https://billing.valtrim.com' \
  FOLLOW_UP_EMAIL_MODE='PREVIEW'
```

Open **Calendar → Builder follow-ups** and inspect the recipient, subject and
message for representative EXT, DM and HW checkpoints. Preview does not create
an outbox attempt, issue a response token, or mark a checkpoint complete. Its
button URLs intentionally contain a non-working preview token.

## Configure secure Superintendent responses

Generate a different high-entropy value from the Cron secret. Store it only as
an Edge Function secret. It signs the non-guessable response link; the raw
signed token is never stored in Postgres.

```sh
openssl rand -hex 32
supabase secrets set --project-ref dsernjmiaofkkddeisty \
  FOLLOW_UP_RESPONSE_SECRET='<different generated value>' \
  FOLLOW_UP_PUBLIC_APP_URL='https://billing.valtrim.com'
```

Deploy both functions after the database migration is applied:

```sh
supabase functions deploy builder-follow-up-email \
  --project-ref dsernjmiaofkkddeisty --no-verify-jwt
supabase functions deploy builder-follow-up-response \
  --project-ref dsernjmiaofkkddeisty --no-verify-jwt
```

The functions are public at the gateway because Superintendents do not have
ValtrimBilling accounts. The response function still rejects every request
without a valid HMAC signature, an active one-time token, the original
Superintendent assignment, and the original Production date.

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
- issue one stable, expiring response id for that outbox item;
- mark the checkpoint complete only after Resend accepts the message.

When a Superintendent submits **Confirmed**, ValtrimBilling binds the
confirmation to the exact current Production date and closes the remaining
checkpoints for that date. **Not ready** atomically records the response and
moves that exact Production event to the selected date. The calendar, date
history, follow-up state, and new checkpoint matrix are updated in the same
database transaction. Google Calendar remains downstream and receives the
changed date through the existing manual synchronization.

Every submitted response creates a durable acknowledgement for the Jobsite
Superintendent. A Not ready response also creates a durable internal schedule-
change alert using the recipients configured under **Escalation settings**.
ValtrimBilling attempts these messages immediately in LIVE mode; failed or
interrupted deliveries remain in
`valtrim.builder_follow_up_response_emails` and the scheduled `send_due` run
retries them with a stable Resend idempotency key. Email delivery failure never
rolls back an already valid Jobsite response or its Production date change.

The **Recent Jobsite responses** panel shows who confirmed, who rescheduled,
the original and final dates, the note, and the response time. Production
calendar cards also show the current follow-up state. Legacy pending requests
created before this automatic behavior remain reviewable until resolved.

It will also prioritize due no-response escalations before normal checkpoints.
Each `NO_RESPONSE` activity event owns at most one internal email. Repeated
clicks cannot create duplicates. A response/status change, reschedule,
cancel/completion, inactive source, disabled setting, or passed work date
cancels an unsent escalation. Weekends are excluded from the initial business-
day calculation; company holidays are not yet subtracted.

To stop delivery immediately without deleting data, set
`FOLLOW_UP_EMAIL_MODE=PREVIEW`. To remove the schedule, run:

```sql
select cron.unschedule('builder-follow-up-email-weekdays');
```
