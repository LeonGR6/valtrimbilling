# Sequence Sheet email

ValtrimBilling can email a saved Phase as an HTML-only Sequence Sheet. The
message contains the same four columns shown in the application:

- Lot
- Plan
- Reverse
- Options for selected plan

The message has no PDF attachment and no link back to ValtrimBilling.

## Workflow

Creating a Phase opens the email dialog after the Phase has been persisted.
The assigned Jobsite Superintendent is the initial recipient. Admin and Project
Management users can review the exact rendered email, change or add recipients,
and send it. The action remains available as `Email Sequence Sheet` from the
Phase card and Phase detail page.

The `sequence-sheet-email` Edge Function reloads the Phase, Job, Lots, Plans and
selected Options using the signed-in user's permissions before rendering or
sending. Browser data is not trusted as the source of the email table.

## Edge Function configuration

Previewing requires only a signed-in Admin or Project Management user. Sending
uses Resend and requires these Edge Function secrets:

```text
RESEND_API_KEY
```

The sender and reply-to can use Sequence Sheet-specific secrets:

```text
SEQUENCE_SHEET_FROM_EMAIL
SEQUENCE_SHEET_REPLY_TO
```

When those are not configured, the function reuses:

```text
FOLLOW_UP_FROM_EMAIL
FOLLOW_UP_REPLY_TO
```

Deploy only this function with the Supabase CLI after linking the intended
project:

```text
supabase functions deploy sequence-sheet-email --use-api
```
