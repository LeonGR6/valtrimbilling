# DM reminder emails

The day before a normal DM, the Job's **Supervisor** and **Project Manager** get an email
with the Sequence Sheet lots that DM covers (Lot, Plan, Reverse, options; no prices).

## What counts

- Only the **BASE** schedule of a **DM** stage that is on (not `BASEBOARD_INSTALL`, not `DIVISION`).
- Of an activity that is still `ACTIVE` and a Job that is still active.
- One email per DM (per `production_schedules` row), with the lots of that DM
  (`production_schedule_lots`; utility buildings left out).
- "The day before" is the calendar day before, in California time. A Saturday DM is
  announced on Friday; a Monday DM on Sunday (the screen has a date field to look at any day).

## Who gets it

From the DM's activity: its Job, and from the Job `supervisor_id` and `project_manager_id`
(Company Contacts). The dialog starts with both and lets the user remove them or add anyone
else (up to 10).

## Modes (`DM_REMINDER_EMAIL_MODE` secret)

| Mode | What happens |
|---|---|
| `PREVIEW` (default, also for any other value) | The email can be reviewed in Calendar > DM reminders; sending is refused. |
| `TEST` | Sent only to `DM_REMINDER_TEST_RECIPIENTS` (comma separated), subject `[TEST] ...`, with a banner that says who it would have gone to. Never to the Job's contacts. |
| `LIVE` | Sent to the recipients chosen in the dialog. A LIVE DM is not sent twice for the same day. |

Sender and reply-to reuse the Sequence Sheet email secrets (`DM_REMINDER_FROM_EMAIL` and
`DM_REMINDER_REPLY_TO` win when set).

```bash
npm run secrets:set --workspace=@valtrimbilling/backend DM_REMINDER_EMAIL_MODE=TEST DM_REMINDER_TEST_RECIPIENTS=you@valtriminc.com
```

## Record

`valtrim.dm_reminder_emails` has one row per send (mode, recipients, subject, provider id).
A unique index on `(schedule_id, event_date)` for `mode = 'LIVE'` is what stops a DM from
being announced twice. Moving the DM to another day makes it announceable again.

## Going automatic (not built yet)

The Edge Function already separates loading (`_shared/dmReminderLoader.ts`), rendering and
sending. An automatic run needs only:

1. A `send_due` action: load the DMs of tomorrow, skip those with `sentAt`, send each with its
   default recipients, record it.
2. A cron secret check, like `builder-follow-up-email` (`FOLLOW_UP_CRON_SECRET`).
3. A `pg_cron` job, like `quickbooks-payments-sync`, once a day in the morning (California time).
4. `DM_REMINDER_EMAIL_MODE=LIVE`.
