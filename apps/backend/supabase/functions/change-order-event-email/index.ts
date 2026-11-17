// Tells a Job's Scheduling contact which lots of an Extra / Change Order will be charged with an
// event already on the Calendar (EXT, DM or HW): it renders the email for review (preview) and
// sends it (send).
//
// POST body: {
//   action: 'preview' | 'send',
//   changeOrderId: number,
//   recipientEmails?, subject?, requestId?               // send only
// }
//
// The browser only names the Extra / CO. Everything the email says, and the Scheduling contact it
// starts addressed to, is loaded here with the signed-in user's own permissions
// (changeOrderEventEmailLoader.ts). Who it goes to is the person's choice: the Scheduling contact
// comes preloaded and can be removed or joined by anyone else. Nothing is sent until "send".
// Each send is recorded, so the Extra / CO can say when Scheduling was told.
//
// Sending uses Resend, like the Sequence Sheet email, and reuses its sender secrets.

import { handlePreflight, json } from "../_shared/cors.ts";
import {
  buildChangeOrderEmailDraft,
  renderChangeOrderEmail,
} from "../_shared/changeOrderEventEmail.ts";
import { loadChangeOrderEmailSnapshot } from "../_shared/changeOrderEventEmailLoader.ts";
import {
  recipientEmails,
  requiredPositiveId,
  subjectOverride,
} from "../_shared/optionsEmailRequestParsing.ts";
import { sendSequenceSheetWithResend } from "../_shared/sequenceSheetEmail.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

type Action = "preview" | "send";

interface RequestBody {
  action?: Action;
  changeOrderId?: string | number;
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
  if (!(error instanceof Error)) return "Unknown Extra / Change Order email error.";
  return error.message.slice(0, 1000);
}

function requestId(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/u.test(normalized)) {
    throw new Error(
      "The email request identifier is invalid. Reopen the email dialog.",
    );
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

// The roles that create and change Extras / Change Orders (the ones the application lets in).
async function authorizeUser(req: Request) {
  const caller = userClient(req);
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser();
  if (authError || !user) return null;

  const { data: profile, error: profileError } = await caller
    .from("app_users")
    .select("name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (
    !profile?.is_active ||
    !["ADMIN", "PROJECT_MANAGEMENT"].includes(profile.role)
  ) {
    return null;
  }

  return {
    caller,
    userId: user.id,
    name: String(profile.name ?? user.email ?? "A ValtrimBilling user"),
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const auth = await authorizeUser(req);
    if (!auth) {
      return json({
        error: "Sign in with an Admin or Project Management role first.",
      }, 401);
    }

    const body = await req.json().catch(() => ({})) as RequestBody;
    const action = body.action ?? "preview";
    if (!["preview", "send"].includes(action)) {
      return json({ error: "Select a supported email action." }, 400);
    }

    const { changeOrderId, lotCount, snapshot } =
      await loadChangeOrderEmailSnapshot(
        auth.caller,
        auth.name,
        requiredPositiveId(body.changeOrderId, "Extra / Change Order"),
      );
    const rendered = renderChangeOrderEmail(snapshot);

    if (action === "preview") {
      return json({
        preview: true,
        snapshot,
        rendered,
        draft: buildChangeOrderEmailDraft(snapshot),
      });
    }

    // --- send ---
    const recipients = recipientEmails(body.recipientEmails);
    const subject = subjectOverride(body.subject, rendered.subject);
    const providerMessageId = await sendSequenceSheetWithResend({
      apiKey: firstEnv(["RESEND_API_KEY"]),
      from: firstEnv([
        "CHANGE_ORDER_FROM_EMAIL",
        "SEQUENCE_SHEET_FROM_EMAIL",
        "FOLLOW_UP_FROM_EMAIL",
      ]),
      replyTo: firstEnv([
        "CHANGE_ORDER_REPLY_TO",
        "SEQUENCE_SHEET_REPLY_TO",
        "FOLLOW_UP_REPLY_TO",
      ]),
      idempotencyKey: [
        "change-order-event",
        changeOrderId,
        requestId(body.requestId),
        await fingerprint([recipients.join(","), subject]),
      ].join("-"),
      recipients,
      rendered: { ...rendered, subject },
    });

    // The email is out. Recording it is what lets the Extra / CO say when Scheduling was told; a
    // failure here is logged, not reported as a failed send.
    const sentAt = new Date().toISOString();
    const { error: logError } = await serviceClient()
      .from("change_order_event_emails")
      .insert({
        change_order_id: changeOrderId,
        events: [...new Set(snapshot.groups.map((group) => group.event))],
        lot_count: lotCount,
        recipients,
        subject,
        provider_message_id: providerMessageId,
        sent_by: auth.userId,
        sent_at: sentAt,
      });
    if (logError) {
      console.error("Extra / CO email was sent but not recorded:", logError);
    }

    return json({
      sent: true,
      sentAt,
      providerMessageId,
      recipients,
      rendered: { ...rendered, subject },
    });
  } catch (error) {
    console.error("Extra / Change Order email failed:", error);
    return json({ error: safeError(error) }, 400);
  }
});
