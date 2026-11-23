// Follow-ups of proposals still waiting for the customer (block B, step B7, and the
// review of 23 Nov 2026). pg_cron calls it every 15 minutes; emails go out only from
// 8:00 AM to 6:00 PM California time.
// - The 24-hour reminder to the customer, from the mailbox that sent the proposal.
// - The 48-hour email to that coordinator to call the Builder's superintendent.
// - The email to that coordinator when every offered day started without an answer.
// Each one is claimed through a guarded RPC first, so no proposal gets it twice. One
// attempt each: a failure is recorded in service_communications and shown on screen.
//
// No caller credential is required, like the travel check: the time comes from the
// server clock and each email can be sent once, so any caller can at most send emails
// that are already due.
import { json } from "../_shared/cors.ts";
import {
  type AdminClient,
  customerEmailDeliveryFromEnv,
  deliverCustomerEmail,
  notifyCoordinator,
  REQUEST_COLUMNS,
} from "../_shared/customerServiceCoordinator.ts";
import { dueCoordinatorNotices, type NoticeProposalRow } from "../_shared/customerServiceCoordinatorNotices.ts";
import { coordinatorNoticeEmail, mailingAddress } from "../_shared/customerServiceEmailTemplates.mjs";
import {
  dueReminders,
  prepareReminder,
  reminderCutoff,
  type ReminderProposalRow,
} from "../_shared/customerServiceProposalReminders.ts";
import { proposalLinksFromEnv } from "../_shared/customerServiceProposalLink.ts";
import { serviceClient } from "../_shared/supabase.ts";

type Delivery = ReturnType<typeof customerEmailDeliveryFromEnv>;
const OPTIONS = "service_proposal_options!service_proposal_options_proposal_id_fkey";

async function sendReminders(admin: AdminClient, delivery: Delivery, now: Date) {
  const waiting = await admin.from("service_proposals")
    // Proposals and options are linked twice (an option's proposal, a proposal's
    // accepted option); the options of each proposal are the first link.
    .select(`id, public_id, request_id, status, sender_mailbox, sent_at, reminder_sent_at, created_by, ${OPTIONS}(option_number, window_starts_at)`)
    .eq("status", "SENT")
    .is("reminder_sent_at", null)
    .lte("sent_at", reminderCutoff(now).toISOString());
  if (waiting.error) throw waiting.error;
  const due = dueReminders((waiting.data ?? []) as unknown as ReminderProposalRow[], now);
  if (!due.length) return { sent: 0, failed: 0 };

  const claim = await admin.rpc("mark_customer_service_proposal_reminders", {
    p_proposal_ids: due.map((reminder) => reminder.proposalId),
  });
  if (claim.error) throw claim.error;
  const claimed = new Set<number>((claim.data ?? []).map(Number));
  const reminders = due.filter((reminder) => claimed.has(reminder.proposalId));
  if (!reminders.length) return { sent: 0, failed: 0 };

  const requests = await admin.from("service_requests").select(REQUEST_COLUMNS)
    .in("id", reminders.map((reminder) => reminder.requestId));
  if (requests.error) throw requests.error;
  // deno-lint-ignore no-explicit-any
  const requestById = new Map((requests.data ?? []).map((request: any) => [Number(request.id), request]));

  let sent = 0;
  let failed = 0;
  for (const reminder of reminders) {
    const request = requestById.get(reminder.requestId);
    // The same buttons as the invitation, for the days that have not started.
    const links = await proposalLinksFromEnv(reminder.publicId, reminder.options.map((option) => option.number));
    const prepared = request && prepareReminder({ request, options: reminder.options, links, delivery });
    if (!prepared || !prepared.send) {
      console.warn("A proposal reminder was not sent.", reminder.proposalId, prepared ? prepared.message : "Request not found.");
      failed += 1;
      continue;
    }
    const { send: _send, ...email } = prepared;
    const result = await deliverCustomerEmail({
      admin,
      actor: { id: null, email: reminder.senderMailbox },
      requestId: reminder.requestId,
      type: "REMINDER",
      email,
      metadata: { proposalId: reminder.proposalId, options: reminder.options },
    });
    if (result.sent) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

// The Builder's superintendent comes from the request's Job, as on screen.
const NOTICE_REQUEST_COLUMNS = "id, folio, homeowner_name, service_properties(address, city, state, postal_code, " +
  "jobs(builders(name), superintendent:builder_contacts!jobs_superintendent_id_builder_id_superintendent_type_fkey(name, phone, office_phone, email)))";

async function sendNotices(admin: AdminClient, now: Date) {
  const waiting = await admin.from("service_proposals")
    .select(`id, request_id, status, sender_mailbox, sent_at, builder_contacted_at, builder_call_notified_at, days_passed_notified_at, ${OPTIONS}(window_starts_at)`)
    .eq("status", "SENT")
    .or("builder_call_notified_at.is.null,days_passed_notified_at.is.null");
  if (waiting.error) throw waiting.error;
  const due = dueCoordinatorNotices((waiting.data ?? []) as unknown as NoticeProposalRow[], now);
  const kinds = [["BUILDER_CALL", due.builderCall], ["DAYS_PASSED", due.daysPassed]] as const;
  if (!due.builderCall.length && !due.daysPassed.length) return { sent: 0, failed: 0 };

  const requestIds = [...new Set([...due.builderCall, ...due.daysPassed].map((row) => row.request_id))];
  const requests = await admin.from("service_requests").select(NOTICE_REQUEST_COLUMNS).in("id", requestIds);
  if (requests.error) throw requests.error;
  // deno-lint-ignore no-explicit-any
  const requestById = new Map((requests.data ?? []).map((request: any) => [Number(request.id), request]));

  let sent = 0;
  let failed = 0;
  for (const [kind, rows] of kinds) {
    if (!rows.length) continue;
    const claim = await admin.rpc("mark_customer_service_proposal_notices", {
      p_kind: kind,
      p_proposal_ids: rows.map((row) => row.id),
    });
    if (claim.error) throw claim.error;
    const claimed = new Set<number>((claim.data ?? []).map(Number));
    for (const row of rows.filter((entry) => claimed.has(entry.id))) {
      const request = requestById.get(row.request_id);
      const property = request?.service_properties;
      const job = property?.jobs;
      const superintendent = job?.superintendent;
      const result = await notifyCoordinator({
        admin,
        mailbox: row.sender_mailbox,
        requestId: row.request_id,
        email: coordinatorNoticeEmail({
          kind,
          folio: request?.folio ?? "",
          customerName: request?.homeowner_name ?? "",
          address: mailingAddress({
            street: property?.address, city: property?.city, state: property?.state, postalCode: property?.postal_code,
          }),
          builder: kind === "BUILDER_CALL"
            ? {
              name: job?.builders?.name ?? "",
              superintendent: superintendent?.name ?? "",
              phone: superintendent?.phone || superintendent?.office_phone || "",
              email: superintendent?.email ?? "",
            }
            : null,
        }),
        metadata: { proposalId: row.id, kind },
      });
      if (result.sent) sent += 1;
      else failed += 1;
    }
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const delivery = customerEmailDeliveryFromEnv();
    // Nothing is claimed while emails are off, so everything waits.
    if (delivery.mode === "OFF") return json({ status: "EMAILS_OFF" });

    const admin = serviceClient();
    const now = new Date();
    const reminders = await sendReminders(admin, delivery, now);
    const notices = await sendNotices(admin, now);
    return json({ status: "DONE", reminders, notices });
  } catch (error) {
    console.error("Customer Service proposal follow-ups failed.", error);
    return json({ error: "The follow-ups could not be sent." }, 500);
  }
});
