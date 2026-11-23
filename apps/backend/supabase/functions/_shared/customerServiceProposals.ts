// Proposals sent to Customer Service customers (block B, steps B4 path b and B6).
// "Send proposal" offers one or two days, each validated like an appointment with the
// shared capacity rules, and holds them until the customer answers. Until the customer
// page exists (step B5) the customer answers by email or phone and a coordinator records
// the answer. These helpers check the input and build the RPC arguments and the email;
// the Edge Function customer-service-proposals reads the data and calls the RPCs.
import {
  AppointmentInputError,
  type AppointmentRow,
  type HoldRow,
  type RegisterAppointmentInput,
  type RequestRow,
  type TechnicianRow,
  type TravelLegArg,
  type ValidationMessage,
  validateRegistration,
} from "./customerServiceAppointments.ts";
import {
  type ConfirmationInput,
  type ConfirmationRequest,
  type CustomerEmailDelivery,
  parseConfirmationInput,
} from "./customerServiceConfirmationEmail.ts";
import { invitationEmail, mailingAddress } from "./customerServiceEmailTemplates.mjs";

export interface ProposalOptionInput {
  technicianIds: number[];
  date: string;
  windowStart: string;
  workStart: string;
  travelMinutes: Record<string, number>;
}

export interface SendProposalInput {
  requestId: number;
  expectedRequestUpdatedAt: string;
  options: ProposalOptionInput[];
  invitation: ConfirmationInput;
}

const positiveId = (value: unknown) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

const optionLabel = (index: number, count: number) => (count > 1 ? `Option ${index + 1}: ` : "");

// Shape checks only; the business rules run in validateProposalOptions.
export function parseSendProposalInput(body: unknown): SendProposalInput {
  const value = (body ?? {}) as Record<string, unknown>;
  const requestId = positiveId(value.requestId);
  if (!requestId) throw new AppointmentInputError("A valid requestId is required.");
  if (typeof value.expectedRequestUpdatedAt !== "string" || Number.isNaN(Date.parse(value.expectedRequestUpdatedAt))) {
    throw new AppointmentInputError("The request version is required. Reload requests and try again.");
  }
  if (!Array.isArray(value.options) || value.options.length < 1 || value.options.length > 2) {
    throw new AppointmentInputError("A proposal offers one or two days.");
  }
  const options = value.options.map((entry, index) => {
    const option = (entry ?? {}) as Record<string, unknown>;
    const prefix = optionLabel(index, (value.options as unknown[]).length);
    if (!Array.isArray(option.technicianIds) || option.technicianIds.length === 0) {
      throw new AppointmentInputError(`${prefix}Select the technicians assigned to this work.`);
    }
    const technicianIds = option.technicianIds.map(positiveId);
    if (technicianIds.some((id) => id === null)) {
      throw new AppointmentInputError(`${prefix}Select technicians from the technician catalog.`);
    }
    for (const field of ["date", "windowStart", "workStart"] as const) {
      if (typeof option[field] !== "string") throw new AppointmentInputError(`${prefix}${field} is required.`);
    }
    const travel = option.travelMinutes ?? {};
    if (typeof travel !== "object" || Array.isArray(travel)) {
      throw new AppointmentInputError("Travel minutes must be an object keyed by fromRequestId>toRequestId.");
    }
    const travelMinutes: Record<string, number> = {};
    for (const [key, minutes] of Object.entries(travel as Record<string, unknown>)) {
      if (!/^\d+>\d+$/u.test(key) || !Number.isInteger(minutes) || (minutes as number) < 0 || (minutes as number) > 999) {
        throw new AppointmentInputError("Each travel estimate must be a whole number of minutes from 0 to 999.");
      }
      travelMinutes[key] = minutes as number;
    }
    return {
      technicianIds: technicianIds as number[],
      date: option.date as string,
      windowStart: option.windowStart as string,
      workStart: option.workStart as string,
      travelMinutes,
    };
  });
  if (options.length === 2 && options[0].date === options[1].date) {
    throw new AppointmentInputError("Offer the two options on different days.");
  }
  const invitation = parseConfirmationInput(value.invitation);
  if (!invitation) throw new AppointmentInputError("Write the invitation before sending it.");
  return { requestId, expectedRequestUpdatedAt: value.expectedRequestUpdatedAt, options, invitation };
}

// The agenda the server read for one option's day and technicians.
export interface OptionDay {
  appointments: AppointmentRow[];
  holds: HoldRow[];
}

// Each option is checked like an appointment on its own day; the two days never share
// a technician day, so they cannot collide with each other. Returns the arguments for
// send_customer_service_proposal (without the actor and the sender mailbox).
export function validateProposalOptions({ input, request, technicians, days, now = new Date() }: {
  input: SendProposalInput;
  request: RequestRow | null;
  technicians: TechnicianRow[];
  days: OptionDay[];
  now?: Date;
}) {
  const errors: ValidationMessage[] = [];
  const options: Record<string, unknown>[] = [];
  const travel = new Map<string, TravelLegArg>();
  const appointmentIds = new Set<number>();
  const optionIds = new Set<number>();
  input.options.forEach((option, index) => {
    const registration: RegisterAppointmentInput = {
      requestId: input.requestId,
      expectedRequestUpdatedAt: input.expectedRequestUpdatedAt,
      ...option,
      acceptance: "CUSTOMER_ACCEPTED_PROPOSAL",
    };
    const result = validateRegistration({
      input: registration,
      request,
      technicians,
      dayAppointments: days[index]?.appointments ?? [],
      dayHolds: days[index]?.holds ?? [],
      now,
    });
    const prefix = optionLabel(index, input.options.length);
    for (const error of result.errors) {
      // A problem with the request itself is the same for both options; list it once.
      if (error.field === "request" && errors.some((entry) => entry.field === "request")) continue;
      errors.push({ ...error, message: error.field === "request" ? error.message : `${prefix}${error.message}` });
    }
    if (!result.rpcArgs) return;
    const { acceptance: _acceptance, ...slot } = result.rpcArgs.p_appointment;
    options.push(slot);
    for (const leg of result.rpcArgs.p_travel) travel.set(`${leg.fromRequestId}>${leg.toRequestId}`, leg);
    result.rpcArgs.p_expected_appointment_ids.forEach((id) => appointmentIds.add(id));
    result.rpcArgs.p_expected_option_ids.forEach((id) => optionIds.add(id));
  });
  if (errors.length || options.length !== input.options.length || !request) return { errors };
  return {
    errors,
    rpcArgs: {
      p_request_id: request.id,
      p_expected_request_updated_at: input.expectedRequestUpdatedAt,
      p_expected_appointment_ids: [...appointmentIds].sort((a, b) => a - b),
      p_expected_option_ids: [...optionIds].sort((a, b) => a - b),
      p_options: options,
      p_travel: [...travel.values()],
    },
  };
}

export type PreparedInvitation =
  | { send: true; to: string; customerEmail: string; testMode: boolean; subject: string; text: string; html: string }
  | { send: false; message: string };

// An invitation always needs the customer's email (decision of 20 Nov 2026): without one
// the coordinator uses "Customer accepted by phone" and nothing is held.
export function prepareInvitation({ input, request, options, delivery }: {
  input: ConfirmationInput;
  request: ConfirmationRequest;
  options: { date: string; windowStart: string }[];
  delivery: CustomerEmailDelivery;
}): PreparedInvitation {
  const customerEmail = request.homeowner_email?.trim() ?? "";
  if (!customerEmail) {
    return {
      send: false,
      message: "This request has no customer email, so a proposal cannot be sent. Add the email in Requests, or " +
        "use Customer accepted by phone once the customer agrees to a day.",
    };
  }
  if (delivery.mode === "OFF") {
    return {
      send: false,
      message: "Customer emails are turned off on the server, so a proposal cannot be sent. Use Customer accepted " +
        "by phone instead.",
    };
  }
  const property = request.service_properties;
  const email = invitationEmail({
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
    greeting: input.greeting,
    message: input.message,
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

export type ProposalAnswerInput =
  | { action: "accept"; proposalId: number; optionId: number; confirmationEmail: ConfirmationInput | null }
  | {
    action: "decline";
    proposalId: number;
    counterDates: string[] | null;
    dayPart: "MORNING" | "MIDDAY" | "AFTERNOON" | null;
    note: string | null;
  };

const dayParts = ["MORNING", "MIDDAY", "AFTERNOON"] as const;
const isoDate = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

// An answer the coordinator records: the customer accepted one option, declined, or
// counter-proposed one to three dates. The RPCs check the proposal and the dates again.
export function parseProposalAnswerInput(body: unknown): ProposalAnswerInput {
  const value = (body ?? {}) as Record<string, unknown>;
  const proposalId = positiveId(value.proposalId);
  if (!proposalId) throw new AppointmentInputError("A valid proposalId is required.");
  if (value.action === "accept") {
    const optionId = positiveId(value.optionId);
    if (!optionId) throw new AppointmentInputError("Choose the option the customer accepted.");
    return { action: "accept", proposalId, optionId, confirmationEmail: parseConfirmationInput(value.confirmationEmail) };
  }
  if (value.action !== "decline") throw new AppointmentInputError("Choose accept or decline.");
  const dates = value.counterDates ?? null;
  if (dates !== null && (!Array.isArray(dates) || dates.length > 3 || !dates.every(isoDate))) {
    throw new AppointmentInputError("Enter up to three valid dates.");
  }
  const counterDates = dates && dates.length ? dates as string[] : null;
  if (counterDates && new Set(counterDates).size !== counterDates.length) {
    throw new AppointmentInputError("Enter different dates.");
  }
  const dayPart = value.dayPart ?? null;
  if (dayPart !== null && !dayParts.includes(dayPart as typeof dayParts[number])) {
    throw new AppointmentInputError("Choose morning, midday or afternoon.");
  }
  if (dayPart && !counterDates) throw new AppointmentInputError("A part of the day goes with counter-proposed dates.");
  if (value.note !== undefined && value.note !== null && typeof value.note !== "string") {
    throw new AppointmentInputError("The note must be text.");
  }
  const note = typeof value.note === "string" && value.note.trim() ? value.note.trim() : null;
  if (note && note.length > 1000) throw new AppointmentInputError("Keep the note to 1,000 characters or fewer.");
  return {
    action: "decline",
    proposalId,
    counterDates,
    dayPart: dayPart as typeof dayParts[number] | null,
    note,
  };
}
