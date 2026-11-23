// The reminder of a confirmed visit, the business day before from 3:00 PM California time
// (decided 23 Nov 2026). pg_cron calls it every 15 minutes. It picks the scheduled visits
// due for a reminder, claims them through a guarded RPC so no visit is reminded twice,
// and emails each customer from the mailbox of the proposal that booked the visit, or of
// the coordinator who registered it. One attempt per visit, recorded in
// service_communications as a REMINDER with kind VISIT.
//
// No caller credential is required, like the proposal reminders: the time comes from the
// server clock and each visit can be reminded once, so any caller can at most send
// reminders that are already due.
import { json } from "../_shared/cors.ts";
import {
  customerEmailDeliveryFromEnv,
  deliverCustomerEmail,
  REQUEST_COLUMNS,
} from "../_shared/customerServiceCoordinator.ts";
import {
  dueVisitReminders,
  prepareVisitReminder,
  type VisitReminderRow,
} from "../_shared/customerServiceVisitReminders.ts";
import { serviceClient } from "../_shared/supabase.ts";

// A visit on Monday is reminded on Friday: look four days ahead.
const LOOKAHEAD_MS = 4 * 24 * 3_600_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const delivery = customerEmailDeliveryFromEnv();
    // Nothing is claimed while customer emails are off, so the reminders wait.
    if (delivery.mode === "OFF") return json({ status: "EMAILS_OFF" });

    const admin = serviceClient();
    const now = new Date();
    const upcoming = await admin.from("service_appointments")
      .select("id, request_id, state, is_current, window_starts_at, created_at, created_by, proposal_id, visit_reminder_sent_at")
      .eq("is_current", true)
      .eq("state", "SCHEDULED")
      .is("visit_reminder_sent_at", null)
      .gt("window_starts_at", now.toISOString())
      .lt("window_starts_at", new Date(now.getTime() + LOOKAHEAD_MS).toISOString());
    if (upcoming.error) throw upcoming.error;
    const rows = (upcoming.data ?? []) as (VisitReminderRow & { created_by: string | null; proposal_id: number | null })[];
    const due = dueVisitReminders(rows, now);
    if (!due.length) return json({ status: "NONE_DUE" });

    const claim = await admin.rpc("mark_customer_service_visit_reminders", {
      p_appointment_ids: due.map((reminder) => reminder.appointmentId),
    });
    if (claim.error) throw claim.error;
    const claimed = new Set<number>((claim.data ?? []).map(Number));
    const reminders = due.filter((reminder) => claimed.has(reminder.appointmentId));
    if (!reminders.length) return json({ status: "NONE_DUE" });

    const rowById = new Map(rows.map((row) => [row.id, row]));
    const proposalIds = [...new Set(reminders.map((reminder) => rowById.get(reminder.appointmentId)?.proposal_id)
      .filter((id): id is number => Boolean(id)))];
    const creatorIds = [...new Set(reminders.map((reminder) => rowById.get(reminder.appointmentId)?.created_by)
      .filter((id): id is string => Boolean(id)))];
    const [requests, proposals, creators] = await Promise.all([
      admin.from("service_requests").select(REQUEST_COLUMNS).in("id", reminders.map((reminder) => reminder.requestId)),
      proposalIds.length
        ? admin.from("service_proposals").select("id, sender_mailbox").in("id", proposalIds)
        : Promise.resolve({ data: [], error: null }),
      creatorIds.length
        ? admin.from("app_users").select("id, email").in("id", creatorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [requests, proposals, creators]) {
      if (result.error) throw result.error;
    }
    // deno-lint-ignore no-explicit-any
    const requestById = new Map((requests.data ?? []).map((request: any) => [Number(request.id), request]));
    const senderByProposal = new Map((proposals.data ?? []).map((row) => [Number(row.id), String(row.sender_mailbox ?? "")]));
    const emailByUser = new Map((creators.data ?? []).map((row) => [String(row.id), String(row.email ?? "")]));

    let sent = 0;
    let failed = 0;
    for (const reminder of reminders) {
      const row = rowById.get(reminder.appointmentId);
      const mailbox = (row?.proposal_id ? senderByProposal.get(row.proposal_id) : "") ||
        (row?.created_by ? emailByUser.get(row.created_by) : "") || "";
      const request = requestById.get(reminder.requestId);
      const prepared = request && mailbox
        ? prepareVisitReminder({ request, date: reminder.date, windowStart: reminder.windowStart, delivery })
        : null;
      if (!prepared || !prepared.send) {
        console.warn("A visit reminder was not sent.", reminder.appointmentId,
          prepared ? prepared.message : mailbox ? "Request not found." : "No mailbox to send from.");
        failed += 1;
        continue;
      }
      const { send: _send, ...email } = prepared;
      const result = await deliverCustomerEmail({
        admin,
        actor: { id: null, email: mailbox },
        requestId: reminder.requestId,
        appointmentId: reminder.appointmentId,
        type: "REMINDER",
        email,
        metadata: { appointmentId: reminder.appointmentId, kind: "VISIT", date: reminder.date, windowStart: reminder.windowStart },
      });
      if (result.sent) sent += 1;
      else failed += 1;
    }
    return json({ status: "DONE", sent, failed });
  } catch (error) {
    console.error("Customer Service visit reminders failed.", error);
    return json({ error: "The visit reminders could not be sent." }, 500);
  }
});
