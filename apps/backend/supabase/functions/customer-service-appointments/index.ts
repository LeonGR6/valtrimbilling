// Registers an accepted Customer Service appointment. The browser cannot write
// appointments: this function revalidates capacity with the shared rules against
// the current database and then calls one service-role RPC that stores the
// appointment, its travel estimates and the CONFIRMED stage atomically. Options of
// a sent proposal count as busy, like appointments.
// With confirmationEmail (block B, step B4, path a "Customer accepted by phone"), the
// customer then gets a confirmation from the coordinator's own mailbox, recorded in
// service_communications. The appointment stays registered if that email fails.
// Cancelling has no capacity rule and is a guarded RPC the browser calls directly.
import { handlePreflight, json } from "../_shared/cors.ts";
import {
  AppointmentInputError,
  californiaDayRange,
  changedTravelLegs,
  parseRegisterInput,
  statusForDatabaseError,
  validateRegistration,
} from "../_shared/customerServiceAppointments.ts";
import {
  type ConfirmationInput,
  type ConfirmationRequest,
  confirmationFailureMessage,
  customerEmailDelivery,
  parseConfirmationInput,
  prepareConfirmation,
} from "../_shared/customerServiceConfirmationEmail.ts";
import { createCustomerServiceMicrosoftGraph } from "../_shared/customerServiceMicrosoftGraph.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

const ALLOWED_ROLES = ["ADMIN", "SCHEDULING"];

type Actor = { id: string; name: string; email: string };

class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
    this.name = "RequestError";
  }
}

async function authorize(req: Request): Promise<Actor> {
  const caller = userClient(req);
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) throw new RequestError("Sign in first.", 401);

  const { data: profile, error } = await caller
    .from("app_users")
    .select("name, email, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
    throw new RequestError("You do not have permission to register Customer Service appointments.", 403);
  }
  return { id: user.id, name: profile.name ?? "", email: profile.email ?? "" };
}

// Sends the confirmation from the coordinator's mailbox and records the attempt. It
// never throws: the appointment is already registered, so a failure is reported.
async function sendConfirmation({ admin, actor, input, request, appointmentId, date, windowStart }: {
  admin: ReturnType<typeof serviceClient>;
  actor: Actor;
  input: ConfirmationInput;
  request: ConfirmationRequest & { id: number };
  appointmentId: number;
  date: string;
  windowStart: string;
}) {
  const prepared = prepareConfirmation({
    input,
    request,
    date,
    windowStart,
    senderName: actor.name,
    delivery: customerEmailDelivery({
      testRecipient: Deno.env.get("CUSTOMER_SERVICE_TEST_RECIPIENT"),
      customerEmails: Deno.env.get("CUSTOMER_SERVICE_CUSTOMER_EMAILS"),
    }),
  });
  if (!prepared.send) return { status: "NOT_SENT", message: prepared.message };

  let errorMessage: string | null = null;
  try {
    const graph = createCustomerServiceMicrosoftGraph({
      tenantId: Deno.env.get("MS365_TENANT_ID") ?? "",
      clientId: Deno.env.get("MS365_CLIENT_ID") ?? "",
      clientSecret: Deno.env.get("MS365_CLIENT_SECRET") ?? "",
    });
    await graph.sendMail(actor.email, { to: prepared.to, subject: prepared.subject, text: prepared.text });
  } catch (error) {
    console.error("Customer Service confirmation email failed.", error instanceof Error ? error.message : error);
    errorMessage = confirmationFailureMessage(error, actor.email);
  }

  const { error: recordError } = await admin.from("service_communications").insert({
    request_id: request.id,
    appointment_id: appointmentId,
    channel: "EMAIL",
    communication_type: "CUSTOMER_CONFIRMATION",
    status: errorMessage ? "FAILED" : "SENT",
    recipient: prepared.to,
    error_message: errorMessage,
    metadata: {
      sender: actor.email,
      subject: prepared.subject,
      text: prepared.text,
      customerEmail: prepared.customerEmail,
      testMode: prepared.testMode,
    },
    created_by: actor.id,
  });
  if (recordError) console.error("Customer Service confirmation email was not recorded.", recordError.message);

  return errorMessage
    ? { status: "FAILED", message: errorMessage }
    : { status: "SENT", to: prepared.to, testMode: prepared.testMode };
}

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
  const day = californiaDayRange(input.date);
  if (!day) throw new RequestError("Select a valid service date.", 400);

  const admin = serviceClient();
  const [requestResult, techniciansResult, appointmentsResult, holdsResult] = await Promise.all([
    admin.from("service_requests")
      .select("id, folio, workflow_stage, closed_at, valtrim_items_confirmed, estimated_duration_minutes, crew_size, customer_unavailable_dates, due_on, homeowner_name, homeowner_email, description, service_properties(address, city, state, postal_code)")
      .eq("id", input.requestId)
      .maybeSingle(),
    admin.from("service_technician_roster")
      .select("id, name, is_active")
      .in("id", input.technicianIds),
    admin.from("service_appointments")
      .select("id, request_id, technician_ids, window_starts_at, starts_at, ends_at, pickup_minutes, state, service_requests(folio)")
      .eq("is_current", true)
      .overlaps("technician_ids", input.technicianIds)
      .gte("window_starts_at", day.start)
      .lt("window_starts_at", day.end),
    // Days offered in a sent proposal stay held until the customer answers.
    admin.from("service_proposal_holds")
      .select("option_id, request_id, folio, technician_ids, starts_at, ends_at, pickup_minutes")
      .overlaps("technician_ids", input.technicianIds)
      .gte("window_starts_at", day.start)
      .lt("window_starts_at", day.end),
  ]);
  for (const result of [requestResult, techniciansResult, appointmentsResult, holdsResult]) {
    if (result.error) throw result.error;
  }

  const validation = validateRegistration({
    input,
    request: requestResult.data,
    technicians: techniciansResult.data ?? [],
    // deno-lint-ignore no-explicit-any
    dayAppointments: (appointmentsResult.data ?? []) as any,
    dayHolds: holdsResult.data ?? [],
  });
  if (!validation.rpcArgs) {
    throw new RequestError("The appointment cannot be registered.", 422, validation.errors);
  }

  let travel = validation.rpcArgs.p_travel;
  if (travel.length) {
    const ids = [...new Set(travel.flatMap((leg) => [leg.fromRequestId, leg.toRequestId]))];
    const stored = await admin.from("service_travel_estimates")
      .select("from_request_id, to_request_id, minutes")
      .in("from_request_id", ids)
      .in("to_request_id", ids);
    if (stored.error) throw stored.error;
    travel = changedTravelLegs(travel, stored.data ?? []);
  }

  const { data, error } = await admin.rpc("register_customer_service_appointment", {
    p_actor_id: actor.id,
    ...validation.rpcArgs,
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
      // deno-lint-ignore no-explicit-any
      request: requestResult.data as any,
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
    const actor = await authorize(req);
    return await register(req, actor);
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message, errors: error.details ?? [] }, error.status);
    }
    console.error("Customer Service appointment registration failed.", error);
    return json({ error: "The appointment could not be registered. Try again." }, 500);
  }
});
