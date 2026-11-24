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
// Cancelling (test mode only) has no capacity rule and is a guarded RPC the browser calls.
import { handlePreflight, json } from "../_shared/cors.ts";
import {
  AppointmentInputError,
  parseRegisterInput,
  statusForDatabaseError,
  validateRegistration,
} from "../_shared/customerServiceAppointments.ts";
import { type ConfirmationInput, parseConfirmationInput } from "../_shared/customerServiceConfirmationEmail.ts";
import {
  type Actor,
  applyCustomerEmail,
  authorizeCoordinator,
  closePassedProposal,
  loadTechnicianDay,
  onlyChangedTravel,
  REQUEST_COLUMNS,
  RequestError,
  sendConfirmation,
} from "../_shared/customerServiceCoordinator.ts";
import { serviceClient } from "../_shared/supabase.ts";

async function register(req: Request, actor: Actor) {
  const body = await req.json().catch(() => null);
  let input;
  let confirmation: ConfirmationInput | null;
  try {
    input = parseRegisterInput(body);
    confirmation = parseConfirmationInput((body as Record<string, unknown> | null)?.confirmationEmail);
  } catch (error) {
    if (error instanceof AppointmentInputError) throw new RequestError(error.message, 400);
    throw error;
  }
  const admin = serviceClient();
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

  const { data, error } = await admin.rpc("register_customer_service_appointment", {
    p_actor_id: actor.id,
    ...validation.rpcArgs,
    ...(replacedAt ? { p_expected_request_updated_at: replacedAt } : {}),
    p_travel: travel,
  });
  if (error) {
    const status = statusForDatabaseError(error.code);
    if (status === 500) throw error;
    throw new RequestError(error.message, status);
  }
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

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const actor = await authorizeCoordinator(req, "You do not have permission to register Customer Service appointments.");
    return await register(req, actor);
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message, errors: error.details ?? [] }, error.status);
    }
    console.error("Customer Service appointment registration failed.", error);
    return json({ error: "The appointment could not be registered. Try again." }, 500);
  }
});
