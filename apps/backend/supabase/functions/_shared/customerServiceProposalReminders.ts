// The 24-hour reminder of a proposal still waiting for the customer (block B, step B7).
// Decided 18-19 Nov 2026: one reminder, 24 calendar hours after sending (weekends
// included), from the mailbox that sent the proposal. It lists only the days whose
// window has not started; when every day has started nothing is sent and the screen asks
// for a new proposal (decision 6). These helpers pick the proposals and build the email;
// the Edge Function customer-service-proposal-reminders claims and sends them.
import type { ConfirmationRequest, CustomerEmailDelivery } from "./customerServiceConfirmationEmail.ts";
import { mailingAddress, reminderEmail } from "./customerServiceEmailTemplates.mjs";
import { californiaClockAt } from "./customerServiceScheduling.mjs";

export const REMINDER_AFTER_HOURS = 24;

export interface ReminderProposalRow {
  id: number;
  request_id: number;
  status: string;
  sender_mailbox: string;
  sent_at: string;
  reminder_sent_at: string | null;
  created_by: string | null;
  service_proposal_options: { option_number: number; window_starts_at: string }[] | null;
}

export interface DueReminder {
  proposalId: number;
  requestId: number;
  senderMailbox: string;
  createdBy: string | null;
  options: { number: number; date: string; windowStart: string }[];
}

export function reminderCutoff(now: Date) {
  return new Date(now.getTime() - REMINDER_AFTER_HOURS * 3_600_000);
}

export function dueReminders(rows: ReminderProposalRow[], now: Date): DueReminder[] {
  const cutoff = reminderCutoff(now).getTime();
  return rows.flatMap((row) => {
    if (row.status !== "SENT" || row.reminder_sent_at || Date.parse(row.sent_at) > cutoff) return [];
    const options = [...(row.service_proposal_options ?? [])]
      .filter((option) => Date.parse(option.window_starts_at) > now.getTime())
      .sort((left, right) => left.option_number - right.option_number)
      .map((option) => {
        const window = californiaClockAt(new Date(option.window_starts_at));
        return { number: option.option_number, date: window.date, windowStart: window.time };
      });
    if (!options.length) return [];
    return [{
      proposalId: row.id,
      requestId: row.request_id,
      senderMailbox: row.sender_mailbox,
      createdBy: row.created_by,
      options,
    }];
  });
}

export type PreparedReminder =
  | { send: true; to: string; customerEmail: string; testMode: boolean; subject: string; text: string; html: string }
  | { send: false; message: string };

export function prepareReminder({ request, options, delivery }: {
  request: ConfirmationRequest;
  options: DueReminder["options"];
  delivery: CustomerEmailDelivery;
}): PreparedReminder {
  const customerEmail = request.homeowner_email?.trim() ?? "";
  if (!customerEmail) return { send: false, message: "The request has no customer email." };
  if (delivery.mode === "OFF") return { send: false, message: "Customer emails are turned off on the server." };
  const property = request.service_properties;
  const email = reminderEmail({
    folio: request.folio,
    homeownerName: request.homeowner_name,
    options,
    address: mailingAddress({
      street: property?.address,
      city: property?.city,
      state: property?.state,
      postalCode: property?.postal_code,
    }),
    work: request.description,
  });
  const testMode = delivery.mode === "TEST";
  return {
    send: true,
    to: testMode ? delivery.recipient : customerEmail,
    customerEmail,
    testMode,
    subject: testMode ? `[TEST for ${customerEmail}] ${email.subject}` : email.subject,
    text: email.text,
    html: email.html,
  };
}
