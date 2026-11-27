import { assert, assertEquals, assertThrows } from "@std/assert";
import { AppointmentInputError, type AppointmentRow, type HoldRow, type RequestRow } from "./customerServiceAppointments.ts";
import { confirmationFailureMessage, sendFailureIsCertain } from "./customerServiceConfirmationEmail.ts";
import { defaultInvitationText, invitationEmail } from "./customerServiceEmailTemplates.mjs";
import { MicrosoftGraphSendError, MicrosoftGraphSyncError } from "./customerServiceMicrosoftGraph.ts";
import {
  parseProposalAnswerInput,
  parseSendProposalInput,
  prepareInvitation,
  proposalDaysPassed,
  type SendProposalInput,
  validateProposalOptions,
} from "./customerServiceProposals.ts";

// Friday 2026-11-06, 9:00 AM in California. Options on Monday 9 and Tuesday 10 (PST).
const now = new Date("2026-11-06T17:00:00Z");
const request: RequestRow = {
  id: 20, folio: "SR-00000020", workflow_stage: "READY_TO_PROPOSE", closed_at: null,
  valtrim_items_confirmed: true, estimated_duration_minutes: 45, crew_size: 1,
  customer_unavailable_dates: [], due_on: "2026-11-13",
};
const technicians = [
  { id: 4, name: "Tech One", is_active: true },
  { id: 5, name: "Tech Two", is_active: true },
];
const typed = { greeting: "Hi Yesenia,", message: "These times work for us:" };
const body = (overrides: Partial<SendProposalInput> = {}) => ({
  requestId: 20,
  expectedRequestUpdatedAt: "2026-11-05T10:00:00Z",
  options: [
    { technicianIds: [4], date: "2026-11-09", windowStart: "10:00", workStart: "10:00", travelMinutes: { "10>20": 30 } },
    { technicianIds: [5], date: "2026-11-10", windowStart: "08:00", workStart: "08:00", travelMinutes: {} },
  ],
  invitation: typed,
  ...overrides,
});
// Monday 08:00–08:30 for Tech One, so option 1 follows it.
const monday: AppointmentRow = {
  id: 7, request_id: 10, technician_ids: [4], window_starts_at: "2026-11-09T16:00:00Z",
  starts_at: "2026-11-09T16:00:00Z", ends_at: "2026-11-09T16:30:00Z", pickup_minutes: 10,
  service_requests: { folio: "SR-00000010" },
};
// Tuesday 08:00–08:45 held for Tech Two by another request's proposal.
const tuesdayHold: HoldRow = {
  option_id: 41, request_id: 11, folio: "SR-00000011", technician_ids: [5],
  starts_at: "2026-11-10T16:00:00Z", ends_at: "2026-11-10T16:45:00Z", pickup_minutes: 10,
};

Deno.test("a proposal offers one or two days, on different days, with an invitation", () => {
  const parsed = parseSendProposalInput(body());
  assertEquals(parsed.options.length, 2);
  assertEquals(parsed.invitation, typed);
  assertEquals(parseSendProposalInput(body({ options: [body().options[0]] })).options.length, 1);
  // A corrected customer email travels with the proposal; none means keep the saved one.
  assertEquals(parseSendProposalInput(body({ customerEmail: " New@Example.com" } as Partial<SendProposalInput>)).customerEmail,
    "new@example.com");
  assertEquals("customerEmail" in parseSendProposalInput(body()), false);
  // The customer reads the days by date: option 1 is the earliest, whatever the order sent.
  assertEquals(parseSendProposalInput(body({ options: [body().options[1], body().options[0]] })).options
    .map((option) => option.date), ["2026-11-09", "2026-11-10"]);
  for (const bad of [
    body({ options: [] }),
    body({ options: [...body().options, body().options[0]] }),
    body({ options: [body().options[0], { ...body().options[1], date: "2026-11-09" }] }),
    body({ options: [{ ...body().options[0], technicianIds: [] }] }),
    body({ options: [{ ...body().options[0], travelMinutes: { "10>20": 1000 } }] }),
    { ...body(), invitation: undefined },
    body({ invitation: { greeting: "", message: "x" } }),
  ]) {
    assertThrows(() => parseSendProposalInput(bad), AppointmentInputError);
  }
});

Deno.test("each option is checked on its own day and the RPC gets both slots", () => {
  const result = validateProposalOptions({
    input: parseSendProposalInput(body()),
    request,
    technicians,
    days: [{ appointments: [monday], holds: [] }, { appointments: [], holds: [] }],
    now,
  });
  assertEquals(result.errors, []);
  assertEquals(result.rpcArgs?.p_expected_appointment_ids, [7]);
  assertEquals(result.rpcArgs?.p_expected_option_ids, []);
  assertEquals(result.rpcArgs?.p_options, [
    {
      technicianIds: [4], windowStartsAt: "2026-11-09T18:00:00.000Z", windowEndsAt: "2026-11-09T20:00:00.000Z",
      startsAt: "2026-11-09T18:00:00.000Z", endsAt: "2026-11-09T18:45:00.000Z", pickupMinutes: 10,
    },
    {
      technicianIds: [5], windowStartsAt: "2026-11-10T16:00:00.000Z", windowEndsAt: "2026-11-10T18:00:00.000Z",
      startsAt: "2026-11-10T16:00:00.000Z", endsAt: "2026-11-10T16:45:00.000Z", pickupMinutes: 10,
    },
  ]);
  assertEquals(result.rpcArgs?.p_travel, [{ fromRequestId: 10, toRequestId: 20, minutes: 30 }]);
});

Deno.test("a day held by another proposal cannot be offered again, and errors name the option", () => {
  const result = validateProposalOptions({
    input: parseSendProposalInput(body()),
    request,
    technicians,
    days: [{ appointments: [monday], holds: [] }, { appointments: [], holds: [tuesdayHold] }],
    now,
  });
  assertEquals(result.rpcArgs, undefined);
  assert(result.errors.length > 0);
  assert(result.errors.every((error) => error.message.startsWith("Option 2: ")));
});

Deno.test("a request problem is listed once for both options", () => {
  const result = validateProposalOptions({
    input: parseSendProposalInput(body()),
    request: { ...request, workflow_stage: "CONFIRMED" },
    technicians,
    days: [{ appointments: [monday], holds: [] }, { appointments: [], holds: [] }],
    now,
  });
  assertEquals(result.errors, [{
    field: "request", message: "Only an open request waiting for a proposal can get an appointment.",
  }]);
});

const emailRequest = {
  folio: "CS-2031",
  homeowner_name: "Yesenia Hernandez",
  homeowner_email: "customer@example.com",
  work_category: "SHELVING",
  service_properties: { address: "12720 Azure Way-Unit 33", city: "Hawthorne", state: "CA", postal_code: "90250" },
};
const options = [{ date: "2026-11-24", windowStart: "08:00" }, { date: "2026-11-23", windowStart: "10:00" }];

Deno.test("the invitation lists each day with its window and asks the customer to reply", () => {
  const email = invitationEmail({
    folio: "CS-2031", homeownerName: "Yesenia Hernandez", options, address: "12720 Azure Way-Unit 33, Hawthorne, CA 90250",
    work: "Shelving replacement", greeting: "Hi Yesenia,", message: "These times work for us:",
  });
  assertEquals(email.subject, "Choose a day for your Valtrim service visit (CS-2031)");
  assertEquals(email.text, [
    "Hi Yesenia,",
    "These times work for us:",
    "Option 1: Tuesday, November 24, 2026, arrival window 8:00 AM–10:00 AM\n" +
    "Option 2: Monday, November 23, 2026, arrival window 10:00 AM–12:00 PM",
    "Address: 12720 Azure Way-Unit 33, Hawthorne, CA 90250\nWork: Shelving replacement\nReference: CS-2031",
    "Reply to this email with the option that works for you. We are holding both times for you until you answer.",
  ].join("\n\n"));

  const single = invitationEmail({
    folio: "CS-2031", homeownerName: "", options: [options[0]], address: "", work: "", greeting: "Hello,",
    message: "One day:",
  });
  assertEquals(single.subject, "Can we visit on Tue, Nov 24? Your Valtrim service visit (CS-2031)");
  assert(single.text.includes("Tuesday, November 24, 2026, arrival window 8:00 AM–10:00 AM\n\nReference: CS-2031"));
  assert(!single.text.includes("Option 1"));
  assertEquals(defaultInvitationText({ homeownerName: "Yesenia Hernandez" }).greeting, "Hi Yesenia Hernandez,");
});

Deno.test("an invitation needs the customer's email and customer emails turned on", () => {
  const base = { input: typed, request: emailRequest, options };
  const test = prepareInvitation({ ...base, delivery: { mode: "TEST", recipient: "tester@example.com" } });
  assert(test.send);
  assertEquals([test.to, test.customerEmail, test.testMode], ["tester@example.com", "customer@example.com", true]);
  assertEquals(test.subject, "[TEST for customer@example.com] Choose a day for your Valtrim service visit (CS-2031)");
  const noEmail = prepareInvitation({ ...base, request: { ...emailRequest, homeowner_email: null }, delivery: { mode: "LIVE" } });
  assert(!noEmail.send);
  assert(noEmail.message.startsWith("This request has no customer email"));
  const off = prepareInvitation({ ...base, delivery: { mode: "OFF" } });
  assert(!off.send);
  assert(off.message.startsWith("Customer emails are turned off"));
});

Deno.test("a refused invitation is certain; a timeout may still have been sent", () => {
  for (const code of ["FORBIDDEN", "MAILBOX_NOT_FOUND", "REJECTED", "THROTTLED", "AUTH_FAILED"] as const) {
    assert(sendFailureIsCertain(new MicrosoftGraphSendError(code)), code);
  }
  assert(sendFailureIsCertain(new MicrosoftGraphSyncError("AUTH_FAILED")));
  assert(!sendFailureIsCertain(new MicrosoftGraphSendError("UNAVAILABLE")));
  assert(!sendFailureIsCertain(new MicrosoftGraphSyncError("GRAPH_UNAVAILABLE")));
  assert(!sendFailureIsCertain(new Error("network")));
  assertEquals(confirmationFailureMessage(new MicrosoftGraphSendError("THROTTLED"), "a@valtriminc.com"),
    "Microsoft 365 is busy and did not take the email. Try again in a few minutes.");
});

Deno.test("recorded answers: an accepted option, a rejection or one to three counter dates", () => {
  assertEquals(parseProposalAnswerInput({ action: "accept", proposalId: 3, optionId: 8 }), {
    action: "accept", proposalId: 3, optionId: 8, confirmationEmail: null,
  });
  assertEquals(parseProposalAnswerInput({ action: "accept", proposalId: 3, optionId: 8, confirmationEmail: typed })
    .action, "accept");
  assertEquals(parseProposalAnswerInput({ action: "decline", proposalId: 3, counterDates: [], note: "  " }), {
    action: "decline", proposalId: 3, counterDates: null, dayPart: null, note: null,
  });
  assertEquals(parseProposalAnswerInput({
    action: "decline", proposalId: 3, counterDates: ["2026-12-01", "2026-12-02"], dayPart: "MORNING", note: " After 9 ",
  }), { action: "decline", proposalId: 3, counterDates: ["2026-12-01", "2026-12-02"], dayPart: "MORNING", note: "After 9" });
  for (const bad of [
    { action: "accept", proposalId: 3 },
    { action: "close", proposalId: 3 },
    { action: "decline", proposalId: 0 },
    { action: "decline", proposalId: 3, counterDates: ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"] },
    { action: "decline", proposalId: 3, counterDates: ["2026-02-30"] },
    { action: "decline", proposalId: 3, counterDates: ["2026-12-01", "2026-12-01"] },
    { action: "decline", proposalId: 3, counterDates: ["2026-12-01"], dayPart: "EVENING" },
    { action: "decline", proposalId: 3, dayPart: "MORNING" },
  ]) {
    assertThrows(() => parseProposalAnswerInput(bad), AppointmentInputError);
  }
});

Deno.test("the HTML invitation shows each held day as an option card", () => {
  const two = invitationEmail({
    folio: "CS-2031", homeownerName: "Yesenia", options, address: "", work: "Shelving", greeting: "Hi,",
    message: "These times work:",
  });
  assert(two.html.includes(">Choose a day for your service visit</h1>"));
  assert(two.html.includes(">Option 1</div>"));
  assert(two.html.includes(">Option 2</div>"));
  assert(two.html.includes("Tuesday, November 24, 2026"));
  assert(two.html.includes("Arrival window: 10:00 AM–12:00 PM"));
  assert(two.html.includes("We are holding both times for you until you answer."));
  assert(two.html.includes("We are holding 2 times for your Valtrim service visit. Reply to choose one."));
  // An empty address is left out of the details card.
  assert(!two.html.includes(">Address</td>"));
  assert(two.html.includes(">Work</td>"));
  // No line asking for other dates and no signature (removed 23 Nov 2026).
  assert(!two.html.includes("reply with up to three dates"));
  assert(!two.html.includes("Valtrim Customer Service"));

  const one = invitationEmail({
    folio: "CS-2031", homeownerName: "", options: [options[0]], address: "", work: "", greeting: "Hello,",
    message: "One day:",
  });
  assert(one.html.includes(">Can we visit on this day?</h1>"));
  assert(!one.html.includes("Option 1"));
  assert(one.html.includes("We are holding it for you until you answer."));
});

Deno.test("a proposal can be replaced only once every offered day has started", () => {
  const now = new Date("2026-11-25T17:00:00Z"); // Wednesday 9:00 AM
  const started = { window_starts_at: "2026-11-25T16:00:00Z" }; // today 8:00 AM
  const ahead = { window_starts_at: "2026-11-27T16:00:00Z" };
  assert(proposalDaysPassed([started], now));
  assert(!proposalDaysPassed([started, ahead], now));
  assert(!proposalDaysPassed([], now));
});
