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
import { prepareCoordinatorNotice } from "./customerServiceCoordinatorNotices.ts";
import { createCustomerServiceMicrosoftGraph } from "./customerServiceMicrosoftGraph.ts";
import {
  type AppointmentRow,
  californiaDayRange,
  changedTravelLegs,
  type HoldRow,
  statusForDatabaseError,
  type TravelLegArg,
} from "./customerServiceAppointments.ts";
import { proposalDaysPassed } from "./customerServiceProposals.ts";
import { serviceClient, userClient } from "./supabase.ts";

// What the capacity check and the customer emails need from a request.
export const REQUEST_COLUMNS = "id, folio, workflow_stage, closed_at, valtrim_items_confirmed, " +
  "estimated_duration_minutes, crew_size, customer_unavailable_dates, due_on, updated_at, homeowner_name, " +
  "homeowner_email, work_category, service_properties(address, city, state, postal_code)";

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

const REPLACED_REASON = "Every offered day started without an answer; a new proposal replaced it.";

// A request still waiting on a proposal can get a new proposal or a visit only when every
// offered day of the old one has started (decided 23 Nov 2026): the system closes it, and the new proposal is checked against
// the request as it is after that. Returns the request's new updated_at, or null when
// there was nothing to close.
export async function closePassedProposal(admin: AdminClient, request: { id: number; workflow_stage: string; updated_at: string },
  expectedUpdatedAt: string): Promise<string | null> {
  if (request.workflow_stage !== "AWAITING_CUSTOMER") return null;
  if (Date.parse(request.updated_at) !== Date.parse(expectedUpdatedAt)) {
    throw new RequestError("This request changed after you opened it. Reload requests and review the plan again.", 409);
  }
  const waiting = await admin.from("service_proposals")
    .select("id, service_proposal_options!service_proposal_options_proposal_id_fkey(window_starts_at)")
    .eq("request_id", request.id).eq("status", "SENT").maybeSingle();
  if (waiting.error) throw waiting.error;
  if (!waiting.data || !proposalDaysPassed(waiting.data.service_proposal_options ?? [])) {
    throw new RequestError("This request already has a proposal waiting for the customer. Record the answer first.", 409);
  }
  const { error } = await admin.rpc("close_customer_service_proposal", {
    p_proposal_id: waiting.data.id,
    p_reason: REPLACED_REASON,
    p_require_days_passed: true,
  });
  if (error) {
    const status = statusForDatabaseError(error.code);
    if (status === 500) throw error;
    throw new RequestError(error.message, status);
  }
  const reread = await admin.from("service_requests").select("updated_at").eq("id", request.id).single();
  if (reread.error) throw reread.error;
  return reread.data.updated_at;
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
  attachments?: { name: string; contentType: string; content: string }[];
};

// Sends one email from the coordinator's mailbox and records the attempt in
// service_communications. It never throws: the caller decides what a failure means.
// actor.id is who sent it; null for an automatic reminder (step B7).
export async function deliverCustomerEmail({ admin, actor, requestId, appointmentId = null, type, email, metadata = {} }: {
  admin: AdminClient;
  actor: { id: string | null; email: string };
  requestId: number;
  appointmentId?: number | null;
  type: "CUSTOMER_CONFIRMATION" | "APPOINTMENT_PROPOSAL" | "REMINDER" | "COORDINATOR_NOTICE";
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
    await graph.sendMail(actor.email, {
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: email.attachments,
    });
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
      ...(email.attachments?.length ? { attachments: email.attachments.map((file) => file.name) } : {}),
    },
    created_by: actor.id,
  });
  if (recordError) console.error(`Customer Service ${type} email was not recorded.`, recordError.message);
  return failure ? { sent: false, ...failure } : { sent: true };
}

// A notice to the coordinator who sent a proposal (decided 23 Nov 2026), from and to
// their own mailbox, recorded like the customer emails. It never throws.
export async function notifyCoordinator({ admin, mailbox, requestId, email, metadata = {} }: {
  admin: AdminClient;
  mailbox: string;
  requestId: number;
  email: { subject: string; text: string; html: string };
  metadata?: Record<string, unknown>;
}) {
  const prepared = prepareCoordinatorNotice({ mailbox, email, delivery: customerEmailDeliveryFromEnv() });
  if (!prepared) return { sent: false as const, certain: true, message: "Emails are turned off." };
  return await deliverCustomerEmail({
    admin,
    actor: { id: null, email: mailbox },
    requestId,
    type: "COORDINATOR_NOTICE",
    email: prepared,
    metadata,
  });
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
