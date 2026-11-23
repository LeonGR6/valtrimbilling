// Shared by the Edge Functions that act for a signed-in Customer Service coordinator
// (customer-service-appointments and customer-service-proposals): who is calling, and
// the customer emails they send from their own company mailbox (block B, step B4).
import {
  type ConfirmationInput,
  type ConfirmationRequest,
  confirmationFailureMessage,
  customerEmailDelivery,
  prepareConfirmation,
  sendFailureIsCertain,
} from "./customerServiceConfirmationEmail.ts";
import { createCustomerServiceMicrosoftGraph } from "./customerServiceMicrosoftGraph.ts";
import {
  type AppointmentRow,
  californiaDayRange,
  changedTravelLegs,
  type HoldRow,
  type TravelLegArg,
} from "./customerServiceAppointments.ts";
import { serviceClient, userClient } from "./supabase.ts";

// What the capacity check and the customer emails need from a request.
export const REQUEST_COLUMNS = "id, folio, workflow_stage, closed_at, valtrim_items_confirmed, " +
  "estimated_duration_minutes, crew_size, customer_unavailable_dates, due_on, updated_at, homeowner_name, " +
  "homeowner_email, description, service_properties(address, city, state, postal_code)";

// The current appointments and the held proposal days of these technicians on one
// California day: the agenda a new visit is checked against.
export async function loadTechnicianDay(admin: AdminClient, technicianIds: number[], date: string) {
  const day = californiaDayRange(date);
  if (!day) throw new RequestError("Select a valid service date.", 400);
  const [appointments, holds] = await Promise.all([
    admin.from("service_appointments")
      .select("id, request_id, technician_ids, window_starts_at, starts_at, ends_at, pickup_minutes, state, service_requests(folio)")
      .eq("is_current", true)
      .overlaps("technician_ids", technicianIds)
      .gte("window_starts_at", day.start)
      .lt("window_starts_at", day.end),
    // Days offered in a sent proposal stay held until the customer answers.
    admin.from("service_proposal_holds")
      .select("option_id, request_id, folio, technician_ids, starts_at, ends_at, pickup_minutes")
      .overlaps("technician_ids", technicianIds)
      .gte("window_starts_at", day.start)
      .lt("window_starts_at", day.end),
  ]);
  if (appointments.error) throw appointments.error;
  if (holds.error) throw holds.error;
  return {
    appointments: (appointments.data ?? []) as unknown as AppointmentRow[],
    holds: (holds.data ?? []) as HoldRow[],
  };
}

// The RPCs write every leg they receive as MANUAL; an unchanged leg keeps its source.
export async function onlyChangedTravel(admin: AdminClient, legs: TravelLegArg[]) {
  if (!legs.length) return legs;
  const ids = [...new Set(legs.flatMap((leg) => [leg.fromRequestId, leg.toRequestId]))];
  const stored = await admin.from("service_travel_estimates")
    .select("from_request_id, to_request_id, minutes")
    .in("from_request_id", ids)
    .in("to_request_id", ids);
  if (stored.error) throw stored.error;
  return changedTravelLegs(legs, stored.data ?? []);
}

const ALLOWED_ROLES = ["ADMIN", "SCHEDULING"];

export type Actor = { id: string; name: string; email: string };
export type AdminClient = ReturnType<typeof serviceClient>;

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
    this.name = "RequestError";
  }
}

export async function authorizeCoordinator(req: Request, deniedMessage: string): Promise<Actor> {
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
    throw new RequestError(deniedMessage, 403);
  }
  return { id: user.id, name: profile.name ?? "", email: profile.email ?? "" };
}

export function customerEmailDeliveryFromEnv() {
  return customerEmailDelivery({
    testRecipient: Deno.env.get("CUSTOMER_SERVICE_TEST_RECIPIENT"),
    customerEmails: Deno.env.get("CUSTOMER_SERVICE_CUSTOMER_EMAILS"),
  });
}

export type CustomerEmail = {
  to: string;
  customerEmail: string;
  testMode: boolean;
  subject: string;
  text: string;
  html?: string;
};

// Sends one email from the coordinator's mailbox and records the attempt in
// service_communications. It never throws: the caller decides what a failure means.
// actor.id is who sent it; null for an automatic reminder (step B7).
export async function deliverCustomerEmail({ admin, actor, requestId, appointmentId = null, type, email, metadata = {} }: {
  admin: AdminClient;
  actor: { id: string | null; email: string };
  requestId: number;
  appointmentId?: number | null;
  type: "CUSTOMER_CONFIRMATION" | "APPOINTMENT_PROPOSAL" | "REMINDER";
  email: CustomerEmail;
  metadata?: Record<string, unknown>;
}): Promise<{ sent: true } | { sent: false; certain: boolean; message: string }> {
  let failure: { certain: boolean; message: string } | null = null;
  try {
    const graph = createCustomerServiceMicrosoftGraph({
      tenantId: Deno.env.get("MS365_TENANT_ID") ?? "",
      clientId: Deno.env.get("MS365_CLIENT_ID") ?? "",
      clientSecret: Deno.env.get("MS365_CLIENT_SECRET") ?? "",
    });
    await graph.sendMail(actor.email, { to: email.to, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Customer Service ${type} email failed.`, error instanceof Error ? error.message : error);
    failure = { certain: sendFailureIsCertain(error), message: confirmationFailureMessage(error, actor.email) };
  }

  const { error: recordError } = await admin.from("service_communications").insert({
    request_id: requestId,
    appointment_id: appointmentId,
    channel: "EMAIL",
    communication_type: type,
    status: failure ? "FAILED" : "SENT",
    recipient: email.to,
    error_message: failure?.message ?? null,
    metadata: {
      ...metadata,
      sender: actor.email,
      subject: email.subject,
      text: email.text,
      customerEmail: email.customerEmail,
      testMode: email.testMode,
    },
    created_by: actor.id,
  });
  if (recordError) console.error(`Customer Service ${type} email was not recorded.`, recordError.message);
  return failure ? { sent: false, ...failure } : { sent: true };
}

// The confirmation of a registered visit (path a, or an accepted proposal). The visit is
// already saved, so a failure is reported, never thrown.
export async function sendConfirmation({ admin, actor, input, request, appointmentId, date, windowStart }: {
  admin: AdminClient;
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
    delivery: customerEmailDeliveryFromEnv(),
  });
  if (!prepared.send) return { status: "NOT_SENT", message: prepared.message };

  const { send: _send, ...email } = prepared;
  const result = await deliverCustomerEmail({
    admin,
    actor,
    requestId: request.id,
    appointmentId,
    type: "CUSTOMER_CONFIRMATION",
    email,
  });
  return result.sent
    ? { status: "SENT", to: prepared.to, testMode: prepared.testMode }
    : { status: "FAILED", message: result.message };
}
