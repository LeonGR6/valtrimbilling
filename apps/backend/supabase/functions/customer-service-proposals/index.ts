// Customer Service proposals for ADMIN/SCHEDULING staff (block B, steps B4 path b and B6).
//
// send     validates one or two days with the shared capacity rules, holds them through
//          send_customer_service_proposal and emails the invitation from the coordinator's
//          own mailbox. If Microsoft refuses the email the system closes the proposal at
//          once, so nothing stays held for a customer who was never told. If the outcome
//          is unknown (a timeout), the days stay held and the coordinator checks Sent Items.
//          A request still waiting on a proposal whose offered days all started gets the
//          new one: the system closes the old one first (decided 23 Nov 2026).
// accept   records that the customer accepted one option: it becomes the appointment and
//          the customer can get the same confirmation email as path a.
// decline  records a rejection (the request needs contact) or a counter-proposal of one to
//          three dates (back to Ready to propose). Both release the held days.
// Cancelling a proposal (test mode only) has no capacity rule: the browser calls that RPC.
import { handlePreflight, json } from "../_shared/cors.ts";
import { AppointmentInputError, statusForDatabaseError } from "../_shared/customerServiceAppointments.ts";
import {
  type Actor,
  type AdminClient,
  applyCustomerEmail,
  authorizeCoordinator,
  closePassedProposal,
  customerEmailDeliveryFromEnv,
  deliverCustomerEmail,
  loadTechnicianDay,
  onlyChangedTravel,
  REQUEST_COLUMNS,
  RequestError,
  sendConfirmation,
} from "../_shared/customerServiceCoordinator.ts";
import {
  parseProposalAnswerInput,
  parseSendProposalInput,
  prepareInvitation,
  validateProposalOptions,
} from "../_shared/customerServiceProposals.ts";
import { proposalLinksFromEnv } from "../_shared/customerServiceProposalLink.ts";
import { californiaClockAt } from "../_shared/customerServiceScheduling.mjs";
import { loadCustomerServiceHolidays } from "../_shared/customerServiceHolidays.ts";
import { serviceClient } from "../_shared/supabase.ts";

const parse = <T>(read: () => T): T => {
  try {
    return read();
  } catch (error) {
    if (error instanceof AppointmentInputError) throw new RequestError(error.message, 400);
    throw error;
  }
};

function databaseFailure(error: { code?: string; message: string }): never {
  const status = statusForDatabaseError(error.code);
  if (status === 500) throw error;
  throw new RequestError(error.message, status);
}

async function send(actor: Actor, body: unknown) {
  let input = parse(() => parseSendProposalInput(body));
  if (!actor.email.trim()) {
    throw new RequestError("Your user has no email, so a proposal cannot be sent from your mailbox.", 422);
  }
  const admin = serviceClient();
  // Holidays are not business days: no day of a proposal can fall on one.
  await loadCustomerServiceHolidays(admin);
  const technicianIds = [...new Set(input.options.flatMap((option) => option.technicianIds))];
  const [requestResult, techniciansResult, ...days] = await Promise.all([
    admin.from("service_requests").select(REQUEST_COLUMNS).eq("id", input.requestId).maybeSingle(),
    admin.from("service_technician_roster").select("id, name, is_active").in("id", technicianIds),
    ...input.options.map((option) => loadTechnicianDay(admin, option.technicianIds, option.date)),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (techniciansResult.error) throw techniciansResult.error;
  // A customer email corrected in the dialog is saved first; what follows checks the
  // request as it is after that.
  // deno-lint-ignore no-explicit-any
  const corrected = await applyCustomerEmail(admin, actor, requestResult.data as any, input);
  input = { ...input, expectedRequestUpdatedAt: corrected.expectedRequestUpdatedAt };
  const request = corrected.request;

  // Checked before holding anything: an invitation needs somewhere to go.
  const invitation = request && prepareInvitation({
    input: input.invitation,
    request,
    options: input.options.map((option) => ({ date: option.date, windowStart: option.windowStart })),
    delivery: customerEmailDeliveryFromEnv(),
  });
  if (invitation && !invitation.send) throw new RequestError(invitation.message, 422);

  const validation = validateProposalOptions({
    input,
    request,
    technicians: techniciansResult.data ?? [],
    days,
  });
  if (!validation.rpcArgs || !invitation?.send) {
    throw new RequestError("The proposal cannot be sent.", 422, validation.errors);
  }

  const replacedAt = await closePassedProposal(admin, request, input.expectedRequestUpdatedAt);
  const { data, error } = await admin.rpc("send_customer_service_proposal", {
    p_actor_id: actor.id,
    p_sender_mailbox: actor.email,
    ...validation.rpcArgs,
    ...(replacedAt ? { p_expected_request_updated_at: replacedAt } : {}),
    p_travel: await onlyChangedTravel(admin, validation.rpcArgs.p_travel),
  });
  if (error) databaseFailure(error);

  // The other days the customer can pick when none of the offered ones works (step B5).
  if (input.alternatives.length) {
    const stored = await admin.from("service_proposals").update({ alternatives: input.alternatives })
      .eq("id", data.proposalId);
    if (stored.error) console.error("The other days of a proposal were not stored.", stored.error.message);
  }
  // The final invitation carries the customer page's buttons when the links are set up.
  const links = await proposalLinksFromEnv(data.publicId, input.options.map((_option, index) => index + 1));
  const final = links
    ? prepareInvitation({
      input: input.invitation,
      request,
      options: input.options.map((option) => ({ date: option.date, windowStart: option.windowStart })),
      delivery: customerEmailDeliveryFromEnv(),
      links,
    })
    : invitation;
  const { send: _send, ...email } = final.send ? final : invitation;
  const delivered = await deliverCustomerEmail({
    admin,
    actor,
    requestId: input.requestId,
    type: "APPOINTMENT_PROPOSAL",
    email,
    metadata: {
      proposalId: data.proposalId,
      options: input.options.map((option) => ({ date: option.date, windowStart: option.windowStart })),
    },
  });
  if (delivered.sent) {
    return json({ ok: true, ...data, invitation: { status: "SENT", to: invitation.to, testMode: invitation.testMode } });
  }
  if (!delivered.certain) {
    return json({
      ok: true,
      ...data,
      invitation: {
        status: "UNCERTAIN",
        message: `Microsoft 365 did not answer, so the invitation may not have been sent. The days stay held: check ` +
          `Sent Items in ${actor.email}. If it is not there, call the customer and record their answer.`,
      },
    });
  }

  // Microsoft refused it: the system closes the proposal and releases the days.
  const { error: closeError } = await admin.rpc("close_customer_service_proposal", {
    p_proposal_id: data.proposalId,
    p_reason: "The invitation email could not be sent.",
  });
  if (closeError) {
    console.error("A proposal whose invitation failed was not closed.", closeError.message);
    throw new RequestError(
      `The invitation was not sent, and the proposal is still holding its days: call the customer and record their answer. ${delivered.message}`,
      502,
    );
  }
  throw new RequestError(
    `The invitation was not sent, so the proposal was cancelled and its days released. ${delivered.message}`,
    502,
  );
}

async function accept(admin: AdminClient, actor: Actor, input: Extract<ReturnType<typeof parseProposalAnswerInput>, { action: "accept" }>) {
  const { data, error } = await admin.rpc("accept_customer_service_proposal", {
    p_actor_id: actor.id,
    p_proposal_id: input.proposalId,
    p_option_id: input.optionId,
  });
  if (error) databaseFailure(error);
  // A repeated click returns the first result without a second email.
  if (!input.confirmationEmail || data.alreadyRecorded) return json({ ok: true, ...data, confirmation: null });

  const [requestResult, optionResult] = await Promise.all([
    admin.from("service_requests").select(REQUEST_COLUMNS).eq("id", data.requestId).maybeSingle(),
    admin.from("service_proposal_options").select("window_starts_at").eq("id", input.optionId).maybeSingle(),
  ]);
  if (requestResult.error || optionResult.error || !requestResult.data || !optionResult.data) {
    return json({
      ok: true,
      ...data,
      confirmation: { status: "FAILED", message: "The visit was registered, but the confirmation could not be prepared." },
    });
  }
  const window = californiaClockAt(new Date(optionResult.data.window_starts_at));
  const confirmation = await sendConfirmation({
    admin,
    actor,
    input: input.confirmationEmail,
    // deno-lint-ignore no-explicit-any
    request: requestResult.data as any,
    appointmentId: data.appointmentId,
    date: window.date,
    windowStart: window.time,
  });
  return json({ ok: true, ...data, confirmation });
}

async function decline(admin: AdminClient, actor: Actor, input: Extract<ReturnType<typeof parseProposalAnswerInput>, { action: "decline" }>) {
  const { data, error } = await admin.rpc("decline_customer_service_proposal", {
    p_actor_id: actor.id,
    p_proposal_id: input.proposalId,
    p_counter_dates: input.counterDates,
    p_counter_day_part: input.dayPart,
    p_note: input.note,
  });
  if (error) databaseFailure(error);
  return json({ ok: true, ...data });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const actor = await authorizeCoordinator(req, "You do not have permission to manage Customer Service proposals.");
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.action === "send") return await send(actor, body);
    const answer = parse(() => parseProposalAnswerInput(body));
    const admin = serviceClient();
    return answer.action === "accept" ? await accept(admin, actor, answer) : await decline(admin, actor, answer);
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message, errors: error.details ?? [] }, error.status);
    }
    console.error("Customer Service proposal request failed.", error);
    return json({ error: "The proposal could not be saved. Try again." }, 500);
  }
});
