// The customer page of a proposal (block B, step B5; decided 23 Nov 2026). The customer
// opens it from a button in the invitation or the reminder and:
// - accepts one of the offered days: the visit is registered and confirmed by email;
// - or, when none works, picks one of the other days the planner found: it is recorded
//   as a counter-proposal for the coordinator to approve (Ready to propose);
// - or says none works: the coordinator calls (Needs contact).
// These helpers check the input and build what the page shows; the Edge Function
// customer-service-proposal-response reads the data and calls the RPCs. The customer
// sees Valtrim, the address, the work and the days: nothing internal (decision 7).
import { AppointmentInputError } from "./customerServiceAppointments.ts";
import { mailingAddress } from "./customerServiceEmailTemplates.mjs";
import { serviceWorkTypeLabel } from "./customerServicePlanning.mjs";
import { californiaClockAt, customerServiceWindows } from "./customerServiceScheduling.mjs";

export type ResponseInput =
  | { action: "view"; token: string }
  | { action: "accept"; token: string; optionNumber: number }
  | { action: "choose"; token: string; alternative: number }
  | { action: "none"; token: string; bestTime: string; phone: string };

// "Please call me" (decided 23 Nov 2026): when and where the coordinator should call.
const optionalText = (value: unknown, limit: number, field: string) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new AppointmentInputError(`The ${field} must be text.`);
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length > limit) throw new AppointmentInputError(`Keep the ${field} to ${limit} characters.`);
  return text;
};

export function parseResponseInput(body: unknown): ResponseInput {
  const value = (body ?? {}) as Record<string, unknown>;
  const token = typeof value.token === "string" ? value.token.trim() : "";
  if (!token || token.length > 200) throw new AppointmentInputError("This link is not valid.");
  if (value.action === "view") return { action: "view", token };
  if (value.action === "none") {
    const phone = optionalText(value.phone, 30, "phone number");
    if (phone && !/^[0-9+().\-\s]{7,30}$/u.test(phone)) throw new AppointmentInputError("Enter a valid phone number.");
    return { action: "none", token, bestTime: optionalText(value.bestTime, 80, "best time to call"), phone };
  }
  if (value.action === "accept") {
    const optionNumber = Number(value.optionNumber);
    if (![1, 2].includes(optionNumber)) throw new AppointmentInputError("Choose one of the offered days.");
    return { action: "accept", token, optionNumber };
  }
  if (value.action === "choose") {
    const alternative = Number(value.alternative);
    if (![0, 1, 2].includes(alternative)) throw new AppointmentInputError("Choose one of the other days.");
    return { action: "choose", token, alternative };
  }
  throw new AppointmentInputError("Choose a day or tell us none works.");
}

export interface CustomerProposalRow {
  id: number;
  status: string;
  sender_mailbox: string;
  accepted_option_id: number | null;
  alternatives: { date: string; windowStart: string }[] | null;
  service_proposal_options: { id: number; option_number: number; window_starts_at: string }[] | null;
  service_requests: {
    folio: string;
    homeowner_name: string | null;
    work_category: string | null;
    service_properties: { address: string | null; city: string | null; state: string | null; postal_code: string | null } | null;
  } | null;
}

const windowLabel = (start: string) => customerServiceWindows.find((window) => window.start === start)?.label ?? "";
const fullName = (name: string | null | undefined) => String(name ?? "").replace(/\s+/gu, " ").trim();

// What the page shows. A day whose window has started can no longer be accepted; other
// days only show while the proposal waits and only from tomorrow on, since the
// coordinator still has to approve them.
export function customerProposalView(row: CustomerProposalRow, now = new Date()) {
  const today = californiaClockAt(now).date;
  const options = [...(row.service_proposal_options ?? [])]
    .sort((left, right) => left.option_number - right.option_number)
    .map((option) => {
      const window = californiaClockAt(new Date(option.window_starts_at));
      return {
        number: option.option_number,
        date: window.date,
        windowStart: window.time,
        windowLabel: windowLabel(window.time),
        started: Date.parse(option.window_starts_at) <= now.getTime(),
        accepted: option.id === row.accepted_option_id,
      };
    });
  const waiting = row.status === "SENT";
  const alternatives = waiting
    ? (row.alternatives ?? []).map((alternative, index) => ({
      index,
      date: alternative.date,
      windowStart: alternative.windowStart,
      windowLabel: windowLabel(alternative.windowStart),
    })).filter((alternative) => alternative.date > today)
    : [];
  const property = row.service_requests?.service_properties;
  return {
    status: row.status,
    folio: row.service_requests?.folio ?? "",
    // The full name, as the emails greet the customer (decided 23 Nov 2026).
    customerName: fullName(row.service_requests?.homeowner_name),
    address: mailingAddress({
      street: property?.address,
      city: property?.city,
      state: property?.state,
      postalCode: property?.postal_code,
    }),
    // The type of work, never the Builder's text (decided 23 Nov 2026).
    work: serviceWorkTypeLabel(row.service_requests?.work_category),
    options,
    alternatives,
  };
}

// The part of the day a counter-proposal records for a picked window.
export function dayPartForWindow(windowStart: string): "MORNING" | "MIDDAY" | "AFTERNOON" {
  if (windowStart < "10:00") return "MORNING";
  return windowStart < "12:00" ? "MIDDAY" : "AFTERNOON";
}

const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
  weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
});

// The note the coordinator reads next to the customer's answer. The "call me" note keeps
// a fixed form, so the list can show the best time to call.
export function customerAnswerNote(answer: {
  alternative?: { date: string; windowStart: string };
  bestTime?: string;
  phone?: string;
}) {
  if (answer.alternative) {
    const window = windowLabel(answer.alternative.windowStart);
    return `From the proposal page: the customer chose ${longDate(answer.alternative.date)}` +
      `${window ? `, arrival window ${window}` : ""}, one of the other days offered.`;
  }
  return [
    "From the proposal page: none of the days work for the customer. Call them to find another time.",
    answer.bestTime && `Best time to call: ${answer.bestTime}.`,
    answer.phone && `Phone: ${answer.phone}.`,
  ].filter(Boolean).join(" ");
}
