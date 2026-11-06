// Server-side validation for registering an accepted Customer Service appointment.
// It applies the same capacity rules as the browser planner
// (customerServiceScheduling.mjs) to data read with the service role, then returns
// the arguments for the atomic register_customer_service_appointment RPC.
import {
  californiaClockAt,
  californiaInstant,
  checkVisitCapacity,
  checkVisitDate,
  customerServicePickupMinutes,
} from "./customerServiceScheduling.mjs";

export const appointmentAcceptances = [
  "CUSTOMER_ACCEPTED_PROPOSAL",
  "COUNTER_PROPOSAL_ACCEPTED",
] as const;
export type AppointmentAcceptance = typeof appointmentAcceptances[number];

export interface RegisterAppointmentInput {
  requestId: number;
  expectedRequestUpdatedAt: string;
  technicianIds: number[];
  date: string;
  windowStart: string;
  workStart: string;
  travelMinutes: Record<string, number>;
  acceptance: AppointmentAcceptance;
}

export interface RequestRow {
  id: number;
  folio: string;
  workflow_stage: string;
  closed_at: string | null;
  valtrim_items_confirmed: boolean | null;
  estimated_duration_minutes: number | null;
  crew_size: number | null;
  customer_unavailable_dates: string[] | null;
  due_on: string | null;
}

export interface TechnicianRow {
  id: number;
  name: string;
  is_active: boolean;
}

export interface AppointmentRow {
  id: number;
  request_id: number;
  technician_ids: number[];
  window_starts_at: string;
  starts_at: string;
  ends_at: string;
  pickup_minutes: number;
  // SCHEDULED or COMPLETED (current appointments only). Omitted means SCHEDULED.
  state?: string;
  service_requests: { folio: string } | null;
}

export interface ValidationMessage {
  field: string;
  message: string;
}

export class AppointmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentInputError";
  }
}

const positiveId = (value: unknown) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

// Shape checks only; the business rules run in validateRegistration.
export function parseRegisterInput(body: unknown): RegisterAppointmentInput {
  const value = (body ?? {}) as Record<string, unknown>;
  const requestId = positiveId(value.requestId);
  if (!requestId) throw new AppointmentInputError("A valid requestId is required.");
  if (typeof value.expectedRequestUpdatedAt !== "string" || Number.isNaN(Date.parse(value.expectedRequestUpdatedAt))) {
    throw new AppointmentInputError("The request version is required. Reload requests and try again.");
  }
  if (!Array.isArray(value.technicianIds) || value.technicianIds.length === 0) {
    throw new AppointmentInputError("Select the technicians assigned to this work.");
  }
  const technicianIds = value.technicianIds.map(positiveId);
  if (technicianIds.some((id) => id === null)) {
    throw new AppointmentInputError("Select technicians from the technician catalog.");
  }
  for (const field of ["date", "windowStart", "workStart"] as const) {
    if (typeof value[field] !== "string") throw new AppointmentInputError(`${field} is required.`);
  }
  const travel = value.travelMinutes ?? {};
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
  if (!appointmentAcceptances.includes(value.acceptance as AppointmentAcceptance)) {
    throw new AppointmentInputError("Choose how the appointment was accepted.");
  }
  return {
    requestId,
    expectedRequestUpdatedAt: value.expectedRequestUpdatedAt,
    technicianIds: technicianIds as number[],
    date: value.date as string,
    windowStart: value.windowStart as string,
    workStart: value.workStart as string,
    travelMinutes,
    acceptance: value.acceptance as AppointmentAcceptance,
  };
}

// The California day [00:00, next 00:00) as UTC instants, for loading the agenda.
export function californiaDayRange(date: string) {
  const start = californiaInstant(date, "00:00");
  if (!start) return null;
  const next = new Date(start.getTime() + 36 * 3600_000);
  const nextDate = californiaClockAt(next).date;
  return { start: start.toISOString(), end: californiaInstant(nextDate, "00:00")!.toISOString() };
}

const plusMinutes = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000);

export function validateRegistration({ input, request, technicians, dayAppointments, now = new Date() }: {
  input: RegisterAppointmentInput;
  request: RequestRow | null;
  technicians: TechnicianRow[];
  dayAppointments: AppointmentRow[];
  now?: Date;
}) {
  const errors: ValidationMessage[] = [];
  if (!request) {
    return { errors: [{ field: "request", message: "The Customer Service request was not found." }] };
  }
  if (!["READY_TO_PROPOSE", "AWAITING_CUSTOMER", "NEEDS_CONTACT"].includes(request.workflow_stage) || request.closed_at) {
    errors.push({ field: "request", message: "Only an open request waiting for a proposal can get an appointment." });
  } else if (request.valtrim_items_confirmed !== true) {
    errors.push({ field: "request", message: "Complete and approve the request information in Requests before planning." });
  }

  const uniqueIds = [...new Set(input.technicianIds)];
  const roster = new Map(technicians.map((technician) => [technician.id, technician]));
  if (uniqueIds.length !== input.technicianIds.length || uniqueIds.some((id) => !roster.get(id)?.is_active)) {
    errors.push({ field: "technicianIds", message: "Select distinct active technicians from the technician catalog." });
  } else if (uniqueIds.length < Number(request.crew_size)) {
    errors.push({ field: "technicianIds", message: `This work requires ${request.crew_size} people; ${uniqueIds.length} selected.` });
  }

  const clock = californiaClockAt(now);
  const dateCheck = checkVisitDate({
    date: input.date, workStart: input.workStart, today: clock.date,
    nowMinutes: clock.minutesSinceMidnight,
    unavailableDates: request.customer_unavailable_dates ?? [], dueOn: request.due_on,
  });
  errors.push(...dateCheck.errors);
  // A date after the due date is blocked while on-time days remain (approved
  // 2026-11-05); an already overdue request keeps only the warning.
  for (const warning of dateCheck.warnings) {
    if (warning.pastDue) errors.push({ field: warning.field, message: warning.message });
  }

  const ids = new Set(uniqueIds);
  const agenda = dayAppointments.flatMap((appointment) => appointment.technician_ids
    .filter((id) => ids.has(id))
    .map((id) => ({
      requestId: String(appointment.request_id),
      requestNumber: appointment.service_requests?.folio ?? `Request ${appointment.request_id}`,
      technicianId: String(id),
      date: input.date,
      start: californiaClockAt(new Date(appointment.starts_at)).time,
      end: californiaClockAt(plusMinutes(appointment.ends_at, appointment.pickup_minutes)).time,
      windowUncertain: false,
      // A COMPLETED window no longer reserves time (same rule as the planner); it
      // still counts in the expected-ids fingerprint.
      blocksAvailability: appointment.state !== "COMPLETED",
    })));
  const capacity = checkVisitCapacity({
    visit: {
      requestId: String(request.id), label: request.folio, windowStart: input.windowStart,
      workStart: input.workStart, durationMinutes: request.estimated_duration_minutes,
    },
    technicians: uniqueIds.map((id) => ({ id: String(id), name: roster.get(id)?.name ?? "Unknown technician" })),
    agenda: dateCheck.dateIsValid ? agenda : [],
    travelMinutes: input.travelMinutes,
  });
  errors.push(...capacity.errors);
  // A registered appointment reserves capacity: every travel leg must be known
  // (approved 2026-11-05). In a draft this is only a warning.
  for (const warning of capacity.warnings) {
    if (warning.travelPending) errors.push({ field: warning.field, message: warning.message });
  }
  const window = capacity.window;
  if (errors.length || !window) return { errors };

  const windowStartsAt = californiaInstant(input.date, window.start)!;
  return {
    errors,
    rpcArgs: {
      p_request_id: request.id,
      p_expected_request_updated_at: input.expectedRequestUpdatedAt,
      p_expected_appointment_ids: dayAppointments.map((appointment) => appointment.id),
      p_appointment: {
        technicianIds: uniqueIds,
        windowStartsAt: windowStartsAt.toISOString(),
        windowEndsAt: californiaInstant(input.date, window.end)!.toISOString(),
        startsAt: californiaInstant(input.date, input.workStart)!.toISOString(),
        endsAt: californiaInstant(input.date, capacity.internalEnd)!.toISOString(),
        pickupMinutes: customerServicePickupMinutes,
        acceptance: input.acceptance,
      },
      p_travel: capacity.travelLegs.map((leg: { fromRequestId: string; toRequestId: string; minutes: number }) => ({
        fromRequestId: Number(leg.fromRequestId), toRequestId: Number(leg.toRequestId), minutes: leg.minutes,
      })),
    },
  };
}

export interface TravelLegArg {
  fromRequestId: number;
  toRequestId: number;
  minutes: number;
}

// The RPC writes every leg it receives as MANUAL. A leg whose stored minutes did
// not change is left out so an unchanged Routes API estimate keeps its source.
export function changedTravelLegs(
  legs: TravelLegArg[],
  stored: { from_request_id: number; to_request_id: number; minutes: number }[],
) {
  const storedMinutes = new Map(stored.map((row) => [`${row.from_request_id}>${row.to_request_id}`, Number(row.minutes)]));
  return legs.filter((leg) => storedMinutes.get(`${leg.fromRequestId}>${leg.toRequestId}`) !== leg.minutes);
}

// Postgres error codes from the RPC mapped to HTTP statuses for the planner.
export function statusForDatabaseError(code: string | undefined) {
  if (code === "40001" || code === "55000" || code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023" || code === "23514") return 422;
  return 500;
}
