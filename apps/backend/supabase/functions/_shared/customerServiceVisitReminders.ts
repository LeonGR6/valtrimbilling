// The reminder of a confirmed visit (decided 23 Nov 2026): the business day before the
// visit, from 3:00 PM California time until emails stop at 6:00 PM, once, from the mailbox
// of the proposal that booked it or of the coordinator who registered it. A visit booked
// after that time gets none: its confirmation just gave the details. The Edge Function
// customer-service-visit-reminders claims and sends them.
import type { ConfirmationRequest, CustomerEmailDelivery } from "./customerServiceConfirmationEmail.ts";
import { mailingAddress, visitReminderEmail } from "./customerServiceEmailTemplates.mjs";
import { serviceWorkTypeLabel } from "./customerServicePlanning.mjs";
import {
  californiaClockAt,
  californiaInstant,
  isCustomerServiceBusinessDay,
  parseServiceDate,
  withinCustomerServiceEmailHours,
} from "./customerServiceScheduling.mjs";

export const VISIT_REMINDER_AT = "15:00";

// The business day before a date: Friday for a Monday visit, skipping holidays too.
export function previousBusinessDay(date: string) {
  const day = parseServiceDate(date);
  if (!day) return "";
  do day.setUTCDate(day.getUTCDate() - 1); while (!isCustomerServiceBusinessDay(day.toISOString().slice(0, 10)));
  return day.toISOString().slice(0, 10);
}

export interface VisitReminderRow {
  id: number;
  request_id: number;
  state: string;
  is_current: boolean;
  window_starts_at: string;
  created_at: string;
  visit_reminder_sent_at: string | null;
}

export interface DueVisitReminder {
  appointmentId: number;
  requestId: number;
  date: string;
  windowStart: string;
}

export function dueVisitReminders(rows: VisitReminderRow[], now: Date): DueVisitReminder[] {
  if (!withinCustomerServiceEmailHours(now)) return [];
  const today = californiaClockAt(now).date;
  return rows.flatMap((row) => {
    if (row.state !== "SCHEDULED" || !row.is_current || row.visit_reminder_sent_at) return [];
    const visit = californiaClockAt(new Date(row.window_starts_at));
    const reminderDay = previousBusinessDay(visit.date);
    if (reminderDay !== today) return [];
    const opensAt = californiaInstant(reminderDay, VISIT_REMINDER_AT);
    if (!opensAt || now.getTime() < opensAt.getTime() || Date.parse(row.created_at) >= opensAt.getTime()) return [];
    return [{ appointmentId: row.id, requestId: row.request_id, date: visit.date, windowStart: visit.time }];
  });
}

export type PreparedVisitReminder =
  | { send: true; to: string; customerEmail: string; testMode: boolean; subject: string; text: string; html: string }
  | { send: false; message: string };

export function prepareVisitReminder({ request, date, windowStart, delivery }: {
  request: ConfirmationRequest;
  date: string;
  windowStart: string;
  delivery: CustomerEmailDelivery;
}): PreparedVisitReminder {
  const customerEmail = request.homeowner_email?.trim() ?? "";
  if (!customerEmail) return { send: false, message: "The request has no customer email." };
  if (delivery.mode === "OFF") return { send: false, message: "Customer emails are turned off on the server." };
  const property = request.service_properties;
  const email = visitReminderEmail({
    folio: request.folio,
    homeownerName: request.homeowner_name,
    date,
    windowStart,
    address: mailingAddress({
      street: property?.address,
      city: property?.city,
      state: property?.state,
      postalCode: property?.postal_code,
    }),
    work: serviceWorkTypeLabel(request.work_category),
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
