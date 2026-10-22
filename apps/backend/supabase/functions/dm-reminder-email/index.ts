// The DM reminder email: tells a Job's Supervisor and Project Manager, the day before, that a
// DM is scheduled and which Sequence Sheet lots it covers (no prices).
//
// POST body: {
//   action: 'list' | 'preview' | 'send',
//   date?: 'YYYY-MM-DD'           // the day of the DMs; default: tomorrow, California time
//   scheduleId?, recipientEmails?, subject?, requestId?     // preview and send
// }
//
// The browser only names the DM (`scheduleId` and `date`). Everything the email says, and who
// it is addressed to, is loaded here with the signed-in user's own permissions
// (dmReminderLoader.ts).
//
// How it goes out is set by the DM_REMINDER_EMAIL_MODE secret (see dmReminderEmail.ts):
//   PREVIEW (default)  the emails can be reviewed but not sent,
//   TEST               sent only to DM_REMINDER_TEST_RECIPIENTS, marked "[TEST]",
//   LIVE               sent to the recipients chosen in the dialog (the Job's contacts).
// A scheduled run would reuse loadDmReminders and the same sending code; it does not exist yet.
//
// Sending uses Resend, like the Sequence Sheet email, and reuses its sender secrets.

import { handlePreflight, json } from "../_shared/cors.ts";
import {
  buildDmReminderDraft,
  type DmReminderEvent,
  type DmReminderMode,
  dmReminderSubject,
  isIsoDate,
  nextDay,
  renderDmReminderEmail,
  reminderMode,
  resolveDelivery,
  testRecipients,
  todayInLosAngeles,
} from "../_shared/dmReminderEmail.ts";
import { loadDmReminders } from "../_shared/dmReminderLoader.ts";
import {
  recipientEmails,
  requiredPositiveId,
  subjectOverride,
} from "../_shared/optionsEmailRequestParsing.ts";
import { sendSequenceSheetWithResend } from "../_shared/sequenceSheetEmail.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

type Action = "list" | "preview" | "send";

interface RequestBody {
  action?: Action;
  date?: string;
  scheduleId?: string | number;
  recipientEmails?: string[];
  subject?: string;
  requestId?: string;
}

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  throw new Error(`Missing Edge Function secret: ${names.join(" or ")}.`);
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "Unknown DM reminder error.";
  return error.message.slice(0, 1000);
}

function requestId(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/u.test(normalized)) {
    throw new Error("The email request identifier is invalid. Reopen the email.");
  }
  return normalized;
}

async function fingerprint(parts: string[]) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join("|")),
  );
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function authorizeUser(req: Request) {
  const caller = userClient(req);
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser();
  if (authError || !user) return null;

  const { data: profile, error: profileError } = await caller
    .from("app_users")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (
    !profile?.is_active ||
    !["ADMIN", "PROJECT_MANAGEMENT", "SCHEDULING"].includes(profile.role)
  ) {
    return null;
  }
  return { caller, userId: user.id };
}

function requiredDate(value: unknown) {
  if (!isIsoDate(value)) throw new Error("Choose the date of the DM.");
  return value;
}

async function loadOne(
  caller: Parameters<typeof loadDmReminders>[0],
  body: RequestBody,
) {
  const date = requiredDate(body.date);
  const scheduleId = requiredPositiveId(body.scheduleId, "DM");
  const [event] = await loadDmReminders(caller, date, scheduleId);
  if (!event) {
    throw new Error("That DM is no longer scheduled for that day. Refresh the list.");
  }
  return event;
}

/** The rendered email of one DM, the way the current mode would send it. */
function renderFor(
  event: DmReminderEvent,
  mode: DmReminderMode,
  chosen: string[],
  test: string[],
) {
  const { testNote } = resolveDelivery(mode, chosen, test);
  return renderDmReminderEmail(event, { testNote });
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const auth = await authorizeUser(req);
    if (!auth) {
      return json({ error: "Sign in with a Scheduling role first." }, 401);
    }

    const body = await req.json().catch(() => ({})) as RequestBody;
    const action = body.action ?? "list";
    if (!["list", "preview", "send"].includes(action)) {
      return json({ error: "Select a supported DM reminder action." }, 400);
    }

    const mode = reminderMode(Deno.env.get("DM_REMINDER_EMAIL_MODE"));
    const test = testRecipients(Deno.env.get("DM_REMINDER_TEST_RECIPIENTS"));

    if (action === "list") {
      const today = todayInLosAngeles();
      const date = body.date == null ? nextDay(today) : requiredDate(body.date);
      const events = await loadDmReminders(auth.caller, date);
      return json({
        mode,
        testRecipients: mode === "TEST" ? test : [],
        today,
        date,
        events: events.map((event) => ({
          ...event,
          draft: buildDmReminderDraft(event),
        })),
      });
    }

    const event = await loadOne(auth.caller, body);
    const draft = buildDmReminderDraft(event);

    if (action === "preview") {
      return json({
        mode,
        testRecipients: mode === "TEST" ? test : [],
        event,
        draft,
        rendered: renderFor(
          event,
          mode,
          draft.recipients.map(({ email }) => email),
          test,
        ),
      });
    }

    // --- send ---
    if (mode === "PREVIEW") {
      return json({
        error:
          "Sending is switched off: DM reminders can only be reviewed right now.",
      }, 409);
    }
    if (mode === "LIVE" && event.sentAt) {
      return json({
        error: "This DM was already announced. It is not sent twice.",
      }, 409);
    }

    const chosen = recipientEmails(body.recipientEmails);
    const delivery = resolveDelivery(mode, chosen, test);
    if (delivery.to.length === 0) {
      throw new Error(
        "Test mode needs the DM_REMINDER_TEST_RECIPIENTS secret: a list of your own email addresses.",
      );
    }

    const rendered = renderDmReminderEmail(event, { testNote: delivery.testNote });
    const typed = subjectOverride(body.subject, dmReminderSubject(event));
    const subject = mode === "TEST" && !typed.startsWith("[TEST]")
      ? `[TEST] ${typed}`
      : typed;
    const providerMessageId = await sendSequenceSheetWithResend({
      apiKey: firstEnv(["RESEND_API_KEY"]),
      from: firstEnv([
        "DM_REMINDER_FROM_EMAIL",
        "SEQUENCE_SHEET_FROM_EMAIL",
        "FOLLOW_UP_FROM_EMAIL",
      ]),
      replyTo: firstEnv([
        "DM_REMINDER_REPLY_TO",
        "SEQUENCE_SHEET_REPLY_TO",
        "FOLLOW_UP_REPLY_TO",
      ]),
      idempotencyKey: [
        `dm-reminder-${mode.toLowerCase()}`,
        event.scheduleId,
        event.eventDate,
        requestId(body.requestId),
        await fingerprint([delivery.to.join(","), subject]),
      ].join("-"),
      recipients: delivery.to,
      rendered: { ...rendered, subject },
    });

    // The email is out. Recording it is what keeps a LIVE DM from being announced twice; a
    // failure here is logged, not reported as a failed send.
    const sentAt = new Date().toISOString();
    const { error: logError } = await serviceClient().from("dm_reminder_emails")
      .insert({
        schedule_id: event.scheduleId,
        event_date: event.eventDate,
        mode,
        recipients: delivery.to,
        subject,
        provider_message_id: providerMessageId,
        sent_by: auth.userId,
        sent_at: sentAt,
      });
    if (logError) console.error("DM reminder was sent but not recorded:", logError);

    return json({
      sent: true,
      mode,
      sentAt,
      providerMessageId,
      recipients: delivery.to,
      intendedRecipients: chosen,
      rendered: { ...rendered, subject },
    });
  } catch (error) {
    console.error("DM reminder failed:", error);
    return json({ error: safeError(error) }, 400);
  }
});
