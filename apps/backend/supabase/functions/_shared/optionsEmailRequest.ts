// The request handler behind the two "options changed in the Sequence Sheet" emails:
// the ones a Purchase Order added (purchase-order-options-email) and the ones someone
// removed (sequence-sheet-options-removed-email). Each Edge Function is one line,
// `Deno.serve(createOptionsEmailHandler(kind))`, so both behave the same way.
//
// POST body: {
//   action: 'preview' | 'send',
//   jobId: number,
//   changes: [{ lotId, optionId, createdOption?, price?, priceNotApplicable? }],
//   recipientEmails?, subject?, requestId?               // send only
// }
//
// The browser only says WHICH options changed. Everything the email shows (the Lots,
// Plans, options, prices, work orders and the people it is addressed to) is loaded
// with the signed-in user's own permissions, so a tampered request cannot make the
// email say something the database does not. See purchaseOrderOptionsEmailLoader.ts.
//
// Sending uses Resend, like the Sequence Sheet email, and reuses its sender secrets.
// Nothing is logged but the error message.

import { handlePreflight, json } from "./cors.ts";
import {
  buildOptionsEmailDraft,
  type OptionsEmailKind,
  renderOptionsEmail,
} from "./purchaseOrderOptionsEmail.ts";
import { loadOptionsEmailSnapshot } from "./purchaseOrderOptionsEmailLoader.ts";
import {
  recipientEmails,
  requestedChanges,
  requiredPositiveId,
  subjectOverride,
} from "./optionsEmailRequestParsing.ts";
import { sendSequenceSheetWithResend } from "./sequenceSheetEmail.ts";
import { userClient } from "./supabase.ts";

type Action = "preview" | "send";

interface RequestBody {
  action?: Action;
  jobId?: string | number;
  changes?: unknown;
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
  if (!(error instanceof Error)) return "Unknown options email error.";
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
    name: String(profile.name ?? user.email ?? "A ValtrimBilling user"),
  };
}

export function createOptionsEmailHandler(kind: OptionsEmailKind) {
  return async (req: Request) => {
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

      const { jobId, snapshot } = await loadOptionsEmailSnapshot(
        auth.caller,
        kind,
        auth.name,
        requiredPositiveId(body.jobId, "Job"),
        requestedChanges(body.changes),
      );
      const rendered = renderOptionsEmail(snapshot);

      if (action === "preview") {
        return json({
          preview: true,
          snapshot,
          rendered,
          draft: buildOptionsEmailDraft(snapshot),
        });
      }

      const recipients = recipientEmails(body.recipientEmails);
      const subject = subjectOverride(body.subject, rendered.subject);
      const idempotencyKey = [
        `sequence-options-${kind}`,
        jobId,
        requestId(body.requestId),
        await fingerprint([recipients.join(","), subject]),
      ].join("-");
      const providerMessageId = await sendSequenceSheetWithResend({
        apiKey: firstEnv(["RESEND_API_KEY"]),
        from: firstEnv([
          "PURCHASE_ORDER_OPTIONS_FROM_EMAIL",
          "SEQUENCE_SHEET_FROM_EMAIL",
          "FOLLOW_UP_FROM_EMAIL",
        ]),
        replyTo: firstEnv([
          "PURCHASE_ORDER_OPTIONS_REPLY_TO",
          "SEQUENCE_SHEET_REPLY_TO",
          "FOLLOW_UP_REPLY_TO",
        ]),
        idempotencyKey,
        recipients,
        rendered: { ...rendered, subject },
      });

      return json({
        sent: true,
        sentAt: new Date().toISOString(),
        providerMessageId,
        recipients,
        rendered: { ...rendered, subject },
      });
    } catch (error) {
      console.error(`Options ${kind} email failed:`, error);
      return json({ error: safeError(error) }, 400);
    }
  };
}
