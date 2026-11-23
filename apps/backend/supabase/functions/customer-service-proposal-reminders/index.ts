// 24-hour reminders of proposals still waiting for the customer (block B, step B7).
// pg_cron calls it every 15 minutes. It picks the proposals sent at least 24 hours ago
// without an answer or a reminder, claims them through a guarded RPC so no proposal is
// reminded twice, and emails each customer from the mailbox that sent the proposal.
// One attempt per proposal: a failure is recorded in service_communications and shown
// on screen, where the 48-hour Builder call follows.
//
// No caller credential is required, like the travel check: the time comes from the
// server clock and each proposal can be reminded once, so any caller can at most send
// reminders that are already due.
import { json } from "../_shared/cors.ts";
import {
  customerEmailDeliveryFromEnv,
  deliverCustomerEmail,
  REQUEST_COLUMNS,
} from "../_shared/customerServiceCoordinator.ts";
import {
  dueReminders,
  prepareReminder,
  reminderCutoff,
  type ReminderProposalRow,
} from "../_shared/customerServiceProposalReminders.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const delivery = customerEmailDeliveryFromEnv();
    // Nothing is claimed while customer emails are off, so the reminders wait.
    if (delivery.mode === "OFF") return json({ status: "EMAILS_OFF" });

    const admin = serviceClient();
    const now = new Date();
    const waiting = await admin.from("service_proposals")
      // Proposals and options are linked twice (an option's proposal, a proposal's
      // accepted option); the options of each proposal are the first link.
      .select("id, request_id, status, sender_mailbox, sent_at, reminder_sent_at, created_by, " +
        "service_proposal_options!service_proposal_options_proposal_id_fkey(option_number, window_starts_at)")
      .eq("status", "SENT")
      .is("reminder_sent_at", null)
      .lte("sent_at", reminderCutoff(now).toISOString());
    if (waiting.error) throw waiting.error;
    const due = dueReminders((waiting.data ?? []) as unknown as ReminderProposalRow[], now);
    if (!due.length) return json({ status: "NONE_DUE" });

    const claim = await admin.rpc("mark_customer_service_proposal_reminders", {
      p_proposal_ids: due.map((reminder) => reminder.proposalId),
    });
    if (claim.error) throw claim.error;
    const claimed = new Set<number>((claim.data ?? []).map(Number));
    const reminders = due.filter((reminder) => claimed.has(reminder.proposalId));
    if (!reminders.length) return json({ status: "NONE_DUE" });

    const requests = await admin.from("service_requests").select(REQUEST_COLUMNS)
      .in("id", reminders.map((reminder) => reminder.requestId));
    if (requests.error) throw requests.error;
    // deno-lint-ignore no-explicit-any
    const requestById = new Map((requests.data ?? []).map((request: any) => [Number(request.id), request]));

    let sent = 0;
    let failed = 0;
    for (const reminder of reminders) {
      const request = requestById.get(reminder.requestId);
      const prepared = request && prepareReminder({
        request,
        options: reminder.options,
        delivery,
      });
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
    return json({ status: "DONE", sent, failed });
  } catch (error) {
    console.error("Customer Service proposal reminders failed.", error);
    return json({ error: "The reminders could not be sent." }, 500);
  }
});
