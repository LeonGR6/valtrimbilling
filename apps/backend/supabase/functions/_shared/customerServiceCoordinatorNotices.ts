// Emails to the coordinator who sent a proposal, only when they must act (decided 23 Nov
// 2026): the customer picked another day or asked for a call on the proposal page (sent
// right away by customer-service-proposal-response), 48 hours passed without an answer,
// or every offered day started (both sent by customer-service-proposal-reminders, from
// 8:00 AM to 6:00 PM California time, once each). They follow the customer emails' mode:
// off sends nothing and test mode sends them to the test inbox.
import type { CustomerEmailDelivery } from "./customerServiceConfirmationEmail.ts";
import type { CustomerEmail } from "./customerServiceCoordinator.ts";
import { proposalDaysPassed } from "./customerServiceProposals.ts";
import { withinCustomerServiceEmailHours } from "./customerServiceScheduling.mjs";

export const BUILDER_CALL_AFTER_HOURS = 48;

export function prepareCoordinatorNotice({ mailbox, email, delivery }: {
  mailbox: string;
  email: { subject: string; text: string; html: string };
  delivery: CustomerEmailDelivery;
}): CustomerEmail | null {
  const to = mailbox.trim();
  if (!to || delivery.mode === "OFF") return null;
  const testMode = delivery.mode === "TEST";
  return {
    to: delivery.mode === "TEST" ? delivery.recipient : to,
    customerEmail: to,
    testMode,
    subject: testMode ? `[TEST for ${to}] ${email.subject}` : email.subject,
    text: email.text,
    html: email.html,
  };
}

export interface NoticeProposalRow {
  id: number;
  request_id: number;
  status: string;
  sender_mailbox: string;
  sent_at: string;
  builder_contacted_at: string | null;
  builder_call_notified_at: string | null;
  days_passed_notified_at: string | null;
  service_proposal_options: { window_starts_at: string }[] | null;
}

// The proposals whose coordinator gets the 48-hour Builder call or the "days passed"
// email now. Once every day has started only "days passed" applies: the Builder call no
// longer helps, as the screen shows.
export function dueCoordinatorNotices(rows: NoticeProposalRow[], now: Date) {
  const due = { builderCall: [] as NoticeProposalRow[], daysPassed: [] as NoticeProposalRow[] };
  if (!withinCustomerServiceEmailHours(now)) return due;
  const cutoff = now.getTime() - BUILDER_CALL_AFTER_HOURS * 3_600_000;
  for (const row of rows) {
    if (row.status !== "SENT") continue;
    if (proposalDaysPassed(row.service_proposal_options ?? [], now)) {
      if (!row.days_passed_notified_at) due.daysPassed.push(row);
    } else if (!row.builder_call_notified_at && !row.builder_contacted_at && Date.parse(row.sent_at) <= cutoff) {
      due.builderCall.push(row);
    }
  }
  return due;
}
