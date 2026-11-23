// The customer's answer to a proposal from the link in the invitation (block B, step
// B5). No sign-in: the signed token in the link is the credential, and it only works
// while the proposal waits for the customer.
//
// view    what the page shows: the offered days, the other days and the request.
// accept  the customer accepts an offered day: it becomes the appointment (accepted by
//         CUSTOMER_LINK) and the customer gets the confirmation from the same mailbox.
// choose  none of the offered days works and the customer picks one of the other days:
//         a counter-proposal the coordinator approves (Ready to propose).
// none    nothing works: the coordinator calls (Needs contact).
// After choose or none the coordinator who sent the proposal gets an email, since they
// must act (decided 23 Nov 2026); after accept nothing, the visit is already registered.
// Opening the page never records anything: mail scanners open links on their own, so
// every answer is a separate POST the customer makes with a button.
import { handlePreflight, json } from "../_shared/cors.ts";
import { AppointmentInputError } from "../_shared/customerServiceAppointments.ts";
import {
  customerEmailDeliveryFromEnv,
  deliverCustomerEmail,
  notifyCoordinator,
  REQUEST_COLUMNS,
} from "../_shared/customerServiceCoordinator.ts";
import { prepareConfirmation } from "../_shared/customerServiceConfirmationEmail.ts";
import { coordinatorNoticeEmail, defaultConfirmationText } from "../_shared/customerServiceEmailTemplates.mjs";
import { PROPOSAL_LINK_SECRET_ENV, verifyProposalToken } from "../_shared/customerServiceProposalLink.ts";
import {
  customerAnswerNote,
  type CustomerProposalRow,
  customerProposalView,
  dayPartForWindow,
  parseResponseInput,
} from "../_shared/customerServiceProposalResponse.ts";
import { serviceClient } from "../_shared/supabase.ts";

const PROPOSAL_COLUMNS = "id, status, sender_mailbox, accepted_option_id, alternatives, request_id, " +
  "service_proposal_options!service_proposal_options_proposal_id_fkey(id, option_number, window_starts_at), " +
  "service_requests(folio, homeowner_name, work_category, service_properties(address, city, state, postal_code))";

class PageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Admin = ReturnType<typeof serviceClient>;
type ProposalRecord = CustomerProposalRow & { request_id: number };

async function loadProposal(admin: Admin, token: string): Promise<ProposalRecord> {
  const secret = Deno.env.get(PROPOSAL_LINK_SECRET_ENV)?.trim() ?? "";
  if (!secret) throw new PageError("This link is not available right now. Reply to the email instead.", 503);
  const publicId = await verifyProposalToken(token, secret);
  if (!publicId) throw new PageError("This link is not valid. Reply to the email instead.", 404);
  const { data, error } = await admin.from("service_proposals").select(PROPOSAL_COLUMNS).eq("public_id", publicId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PageError("This link is not valid. Reply to the email instead.", 404);
  return data as unknown as ProposalRecord;
}

function databaseFailure(error: { code?: string; message: string }): never {
  if (error.code === "55000") {
    throw new PageError("This proposal was already answered, or that day has already started.", 409);
  }
  throw error;
}

// The confirmation the customer gets after accepting, from the mailbox of the proposal.
async function confirmAccepted(admin: Admin, proposal: ProposalRecord, appointmentId: number, optionNumber: number) {
  const option = proposal.service_proposal_options?.find((entry) => entry.option_number === optionNumber);
  const request = await admin.from("service_requests").select(REQUEST_COLUMNS).eq("id", proposal.request_id)
    .maybeSingle();
  if (!option || request.error || !request.data) return;
  // deno-lint-ignore no-explicit-any
  const row = request.data as any;
  const window = customerProposalView(proposal).options.find((entry) => entry.number === optionNumber);
  const prepared = prepareConfirmation({
    input: defaultConfirmationText({ homeownerName: row.homeowner_name }),
    request: row,
    date: window?.date ?? "",
    windowStart: window?.windowStart ?? "",
    delivery: customerEmailDeliveryFromEnv(),
  });
  if (!prepared.send) return;
  const { send: _send, ...email } = prepared;
  await deliverCustomerEmail({
    admin,
    actor: { id: null, email: proposal.sender_mailbox },
    requestId: proposal.request_id,
    appointmentId,
    type: "CUSTOMER_CONFIRMATION",
    email,
    metadata: { proposalId: proposal.id, from: "CUSTOMER_LINK" },
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const input = parseResponseInput(await req.json().catch(() => null));
    const admin = serviceClient();
    const proposal = await loadProposal(admin, input.token);

    if (input.action !== "view") {
      if (proposal.status !== "SENT") {
        return json({ proposal: customerProposalView(proposal) });
      }
      if (input.action === "accept") {
        const option = proposal.service_proposal_options?.find((entry) => entry.option_number === input.optionNumber);
        if (!option) throw new PageError("That day is not part of this proposal.", 404);
        const { data, error } = await admin.rpc("accept_customer_service_proposal", {
          p_actor_id: null,
          p_proposal_id: proposal.id,
          p_option_id: option.id,
        });
        if (error) databaseFailure(error);
        if (!data.alreadyRecorded) await confirmAccepted(admin, proposal, data.appointmentId, input.optionNumber);
      } else {
        const alternative = input.action === "choose" ? proposal.alternatives?.[input.alternative] : undefined;
        if (input.action === "choose" && !customerProposalView(proposal).alternatives.some((entry) => entry.index === input.alternative)) {
          throw new PageError("That day is no longer available. Tell us none works and we will call you.", 409);
        }
        const { data, error } = await admin.rpc("decline_customer_service_proposal", {
          p_actor_id: null,
          p_proposal_id: proposal.id,
          p_counter_dates: alternative ? [alternative.date] : null,
          p_counter_day_part: alternative ? dayPartForWindow(alternative.windowStart) : null,
          p_note: customerAnswerNote(
            input.action === "none" ? { bestTime: input.bestTime, phone: input.phone } : { alternative },
          ),
        });
        if (error) databaseFailure(error);
        if (!data.alreadyRecorded) {
          const view = customerProposalView(proposal);
          await notifyCoordinator({
            admin,
            mailbox: proposal.sender_mailbox,
            requestId: proposal.request_id,
            email: coordinatorNoticeEmail({
              kind: alternative ? "CUSTOMER_PICKED_DAY" : "CALL_CUSTOMER",
              folio: view.folio,
              customerName: view.customerName,
              address: view.address,
              date: alternative?.date,
              windowStart: alternative?.windowStart,
              ...(input.action === "none" ? { bestTime: input.bestTime, phone: input.phone } : {}),
            }),
            metadata: { proposalId: proposal.id, kind: alternative ? "CUSTOMER_PICKED_DAY" : "CALL_CUSTOMER" },
          });
        }
      }
    }
    return json({ proposal: customerProposalView(await loadProposal(admin, input.token)) });
  } catch (error) {
    if (error instanceof PageError) return json({ error: error.message }, error.status);
    if (error instanceof AppointmentInputError) return json({ error: error.message }, 400);
    console.error("Customer proposal response failed.", error);
    return json({ error: "We could not save your answer. Please try again or reply to the email." }, 500);
  }
});
