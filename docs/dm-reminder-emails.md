# DM reminder emails

The day before a normal DM, the Job's **Supervisor** and **Project Manager** get an email
with the Sequence Sheet lots that DM covers (Lot, Plan, Reverse, options; no prices).

## What counts

- The **BASE** schedule of a **DM** stage that is on. Not `BASEBOARD_INSTALL`.
- A **split** DM: splitting turns the BASE schedule off and replaces it with `DIVISION` parts, each with its own date and lots, so each active part is announced on its own day as its own email (the row says "Split DM").
- Of an activity that is still `ACTIVE` and a Job that is still active.
- One email per DM (per `production_schedules` row), with the lots of that DM
  (`production_schedule_lots`; utility buildings left out).
- "The day before" is the calendar day before, in California time. A Saturday DM is
  announced on Friday; a Monday DM on Sunday (the screen has a date field to look at any day).

## Who gets it

From the DM's activity: its Job, and from the Job `supervisor_id` and `project_manager_id`
(Company Contacts). The dialog starts with both and lets the user remove them or add anyone
else (up to 10).

## Sending

Calendar > **DM reminders** lists the DMs of a day (tomorrow by default). "Review email" opens
the exact email with the Supervisor and Project Manager preloaded; the person removes any,
adds other addresses, edits the subject and presses **Send email**. Nothing goes out
otherwise, and "Don't send" tells no one. There are no test or live modes.

Sender and reply-to reuse the Sequence Sheet email secrets (`DM_REMINDER_FROM_EMAIL` and
`DM_REMINDER_REPLY_TO` win when set).

## Record

`valtrim.dm_reminder_emails` has one row per send (recipients, subject, provider id, who). The
list shows "Sent <date>" for a DM already announced, and the dialog warns before sending it
again, but a second send is allowed.

## Going automatic (not built yet)

The Edge Function already separates loading (`_shared/dmReminderLoader.ts`), rendering and
sending. An automatic run needs only:

1. A `send_due` action: load the DMs of tomorrow, skip those with `sentAt`, send each with its
   default recipients, record it.
2. A cron secret check, like `builder-follow-up-email` (`FOLLOW_UP_CRON_SECRET`).
3. A `pg_cron` job, like `quickbooks-payments-sync`, once a day in the morning (California time).
4. Skip a DM that already has a row in the record, so an automatic run never repeats a manual send.
