// Registers an accepted Customer Service appointment. The browser cannot write
// appointments: this function revalidates capacity with the shared rules against
// the current database and then calls one service-role RPC that stores the
// appointment, its travel estimates and the CONFIRMED stage atomically. Options of
// a sent proposal count as busy, like appointments.
// With confirmationEmail (block B, step B4, path a "Customer accepted by phone"), the
// customer then gets a confirmation from the coordinator's own mailbox, recorded in
// service_communications. The appointment stays registered if that email fails.
// A request still waiting on a proposal whose offered days all started can be registered:
// the system closes that proposal first (decided 23 Nov 2026).
// Reschedule block (27 Nov 2026, part R2), chosen with body.action:
// - "reschedule" moves a scheduled visit to a day agreed with the customer. Capacity is
//   checked against that day without the visit being moved; a date after the due date
//   only warns (P3). A visit under way can move until its window ends (P2).
// - "cancel" cancels a scheduled visit, live or in test mode, and can close the request.
// - "close" closes a request that has no confirmed visit (D2).
// With email ({ greeting, message }, part R3), moving and cancelling then email the
// customer from the coordinator's mailbox, with a calendar file that updates or removes
// the visit. Like the confirmation, the change stays saved if that email fails.
// The test-mode cancel_customer_service_appointment RPC was retired in part R5.
import { handlePreflight, json } from "../_shared/cors.ts";
import {
  AppointmentInputError,
  parseCancelInput,
  parseCloseInput,
  parseMoveInput,
  parseRegisterInput,
  statusForDatabaseError,
  validateRegistration,
} from "../_shared/customerServiceAppointments.ts";
import { type ConfirmationInput, parseConfirmationInput } from "../_shared/customerServiceConfirmationEmail.ts";
import {
  type Actor,
  type AdminClient,
  applyCustomerEmail,
  authorizeCoordinator,
  closePassedProposal,
  loadTechnicianDay,
  onlyChangedTravel,
  REQUEST_COLUMNS,
  RequestError,
  sendConfirmation,
  sendVisitChange,
} from "../_shared/customerServiceCoordinator.ts";
import { loadCustomerServiceHolidays } from "../_shared/customerServiceHolidays.ts";
import { californiaClockAt } from "../_shared/customerServiceScheduling.mjs";
import { serviceClient } from "../_shared/supabase.ts";

type Body = Record<string, unknown> | null;

// Input problems are the coordinator's to fix (400); anything else is unexpected.
function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof AppointmentInputError) throw new RequestError(error.message, 400);
    throw error;
  }
}

// An RPC refusal keeps its message and gets the matching status; an unknown error is a 500.
async function callRpc(admin: AdminClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    const status = statusForDatabaseError(error.code);
    if (status === 500) throw error;
    throw new RequestError(error.message, status);
  }
  return data;
}

async function register(body: Body, actor: Actor) {
  let input = parsed(() => parseRegisterInput(body));
  const confirmation: ConfirmationInput | null = parsed(() => parseConfirmationInput(body?.confirmationEmail));
  const admin = serviceClient();
  // Holidays are not business days: a visit cannot be registered on one.
  await loadCustomerServiceHolidays(admin);
  const [requestResult, techniciansResult, day] = await Promise.all([
    admin.from("service_requests").select(REQUEST_COLUMNS).eq("id", input.requestId).maybeSingle(),
    admin.from("service_technician_roster")
      .select("id, name, is_active")
      .in("id", input.technicianIds),
    loadTechnicianDay(admin, input.technicianIds, input.date),
  ]);
  for (const result of [requestResult, techniciansResult]) {
    if (result.error) throw result.error;
  }
  // A customer email corrected in Send to customer is saved first (24 Nov 2026).
  // deno-lint-ignore no-explicit-any
  const corrected = await applyCustomerEmail(admin, actor, requestResult.data as any, input);
  input = { ...input, expectedRequestUpdatedAt: corrected.expectedRequestUpdatedAt };
  const request = corrected.request;

  const validation = validateRegistration({
    input,
    request,
    technicians: techniciansResult.data ?? [],
    dayAppointments: day.appointments,
    dayHolds: day.holds,
  });
  if (!validation.rpcArgs) {
    throw new RequestError("The appointment cannot be registered.", 422, validation.errors);
  }
  const travel = await onlyChangedTravel(admin, validation.rpcArgs.p_travel);
  const replacedAt = await closePassedProposal(admin, request, input.expectedRequestUpdatedAt);

  const data = await callRpc(admin, "register_customer_service_appointment", {
    p_actor_id: actor.id,
    ...validation.rpcArgs,
    ...(replacedAt ? { p_expected_request_updated_at: replacedAt } : {}),
    p_travel: travel,
  });
  const sent = confirmation
    ? await sendConfirmation({
      admin,
      actor,
      input: confirmation,
      request,
      appointmentId: data.appointmentId,
      date: input.date,
      windowStart: input.windowStart,
    })
    : null;
  return json({ ok: true, ...data, confirmation: sent });
}

async function reschedule(body: Body, actor: Actor) {
  const input = parsed(() => parseMoveInput(body));
  const emailInput = parsed(() => parseConfirmationInput(body?.email));
  const admin = serviceClient();
  await loadCustomerServiceHolidays(admin);
  const visit = await admin.from("service_appointments")
    .select("id, request_id, state, is_current, window_starts_at, window_ends_at")
    .eq("id", input.appointmentId)
    .maybeSingle();
  if (visit.error) throw visit.error;
  if (!visit.data) throw new RequestError("The visit was not found.", 404);
  if (visit.data.request_id !== input.requestId) {
    throw new RequestError("This visit belongs to another request. Reload and try again.", 409);
  }
  if (!visit.data.is_current || visit.data.state !== "SCHEDULED") {
    throw new RequestError("Only a scheduled visit can be moved.", 409);
  }
  if (Date.parse(visit.data.window_ends_at) <= Date.now()) {
    throw new RequestError("This visit already ended and cannot be moved.", 409);
  }

  const [requestResult, techniciansResult, day] = await Promise.all([
    admin.from("service_requests").select(REQUEST_COLUMNS).eq("id", input.requestId).maybeSingle(),
    admin.from("service_technician_roster").select("id, name, is_active").in("id", input.technicianIds),
    loadTechnicianDay(admin, input.technicianIds, input.date),
  ]);
  for (const result of [requestResult, techniciansResult]) {
    if (result.error) throw result.error;
  }
  const validation = validateRegistration({
    input,
    // deno-lint-ignore no-explicit-any
    request: requestResult.data as any,
    technicians: techniciansResult.data ?? [],
    dayAppointments: day.appointments,
    dayHolds: day.holds,
    movingAppointmentId: input.appointmentId,
  });
  if (!validation.rpcArgs) {
    throw new RequestError("The visit cannot be moved there.", 422, validation.errors);
  }
  const travel = await onlyChangedTravel(admin, validation.rpcArgs.p_travel);
  const data = await callRpc(admin, "reschedule_customer_service_appointment", {
    p_actor_id: actor.id,
    p_appointment_id: input.appointmentId,
    p_expected_appointment_updated_at: input.expectedAppointmentUpdatedAt,
    p_expected_request_updated_at: input.expectedRequestUpdatedAt,
    p_expected_appointment_ids: validation.rpcArgs.p_expected_appointment_ids,
    p_expected_option_ids: validation.rpcArgs.p_expected_option_ids,
    p_appointment: validation.rpcArgs.p_appointment,
    p_travel: travel,
    p_reason: input.reason,
    p_note: input.note,
  });
  const previous = californiaClockAt(new Date(visit.data.window_starts_at));
  const email = emailInput
    ? await sendVisitChange({
      admin,
      actor,
      input: emailInput,
      // deno-lint-ignore no-explicit-any
      request: requestResult.data as any,
      appointmentId: data.appointmentId,
      change: {
        kind: "MOVED", date: input.date, windowStart: input.windowStart,
        previousDate: previous.date, previousWindowStart: previous.time,
      },
    })
    : null;
  return json({ ok: true, ...data, warnings: validation.warnings, email });
}

async function cancel(body: Body, actor: Actor) {
  const input = parsed(() => parseCancelInput(body));
  const emailInput = parsed(() => parseConfirmationInput(body?.email));
  const admin = serviceClient();
  // What the customer email needs, read before the visit is cancelled.
  let emailContext: { request: unknown; windowStartsAt: string } | null = null;
  if (emailInput) {
    const visit = await admin.from("service_appointments")
      .select("request_id, window_starts_at")
      .eq("id", input.appointmentId)
      .maybeSingle();
    if (visit.error) throw visit.error;
    if (!visit.data) throw new RequestError("The visit was not found.", 404);
    const request = await admin.from("service_requests").select(REQUEST_COLUMNS).eq("id", visit.data.request_id).maybeSingle();
    if (request.error) throw request.error;
    emailContext = { request: request.data, windowStartsAt: visit.data.window_starts_at };
  }
  const data = await callRpc(admin, "cancel_customer_service_visit", {
    p_actor_id: actor.id,
    p_appointment_id: input.appointmentId,
    p_expected_updated_at: input.expectedAppointmentUpdatedAt,
    p_reason: input.reason,
    p_note: input.note,
    p_close_request: input.closeRequest,
    p_duplicate_of_request_id: input.duplicateOfRequestId,
  });
  let email = null;
  if (emailInput && emailContext?.request) {
    const when = californiaClockAt(new Date(emailContext.windowStartsAt));
    email = await sendVisitChange({
      admin,
      actor,
      input: emailInput,
      // deno-lint-ignore no-explicit-any
      request: emailContext.request as any,
      appointmentId: input.appointmentId,
      change: { kind: "CANCELLED", date: when.date, windowStart: when.time },
    });
  }
  return json({ ok: true, ...data, email });
}

async function close(body: Body, actor: Actor) {
  const input = parsed(() => parseCloseInput(body));
  const data = await callRpc(serviceClient(), "close_customer_service_request", {
    p_actor_id: actor.id,
    p_request_id: input.requestId,
    p_expected_updated_at: input.expectedRequestUpdatedAt,
    p_reason: input.reason,
    p_note: input.note,
    p_duplicate_of_request_id: input.duplicateOfRequestId,
  });
  return json({ ok: true, ...data });
}

const actions = { register, reschedule, cancel, close } as const;
const failures: Record<keyof typeof actions, string> = {
  register: "The appointment could not be registered. Try again.",
  reschedule: "The visit could not be moved. Try again.",
  cancel: "The visit could not be cancelled. Try again.",
  close: "The request could not be closed. Try again.",
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const body = await req.json().catch(() => null) as Body;
  const action = (body?.action ?? "register") as keyof typeof actions;
  try {
    const actor = await authorizeCoordinator(req, "You do not have permission to change Customer Service appointments.");
    if (!Object.hasOwn(actions, action)) return json({ error: "Unknown action." }, 400);
    return await actions[action](body, actor);
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message, errors: error.details ?? [] }, error.status);
    }
    console.error(`Customer Service appointment ${action} failed.`, error);
    return json({ error: failures[action] }, 500);
  }
});
