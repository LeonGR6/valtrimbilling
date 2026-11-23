import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { AppointmentInputError } from "./customerServiceAppointments.ts";
import { invitationEmail, reminderEmail } from "./customerServiceEmailTemplates.mjs";
import {
  createProposalToken,
  proposalLinkSettings,
  proposalResponseLinks,
  verifyProposalToken,
} from "./customerServiceProposalLink.ts";
import {
  customerAnswerNote,
  type CustomerProposalRow,
  customerProposalView,
  dayPartForWindow,
  parseResponseInput,
} from "./customerServiceProposalResponse.ts";
import { parseSendProposalInput } from "./customerServiceProposals.ts";

const secret = "a-test-secret-that-is-long-enough-123456";
const publicId = "8f7c2c9e-3b1a-4c55-9d2e-1f0a6b7c8d9e";

Deno.test("a proposal link is signed and only our signature opens it", async () => {
  const token = await createProposalToken(publicId.toUpperCase(), secret);
  assert(token.startsWith(`${publicId}.`));
  assertEquals(await verifyProposalToken(token, secret), publicId);
  assertEquals(await verifyProposalToken(token, "another-secret-that-is-long-enough-12345"), null);
  assertEquals(await verifyProposalToken(`${publicId}.${"A".repeat(43)}`, secret), null);
  assertEquals(await verifyProposalToken("not-a-token", secret), null);
  assertEquals(await verifyProposalToken(`${token}.extra`, secret), null);
});

Deno.test("links need a long secret and an http address; each opens the customer page", () => {
  assertEquals(proposalLinkSettings({ secret: "short", publicAppUrl: "http://localhost:5173" }), null);
  assertEquals(proposalLinkSettings({ secret, publicAppUrl: "" }), null);
  assertEquals(proposalLinkSettings({ secret, publicAppUrl: "localhost:5173" }), null);
  const settings = proposalLinkSettings({ secret, publicAppUrl: " http://localhost:5173/ " });
  assertEquals(settings?.base, "http://localhost:5173");
  const links = proposalResponseLinks("http://localhost:5173", "abc.def", [1, 2]);
  assertEquals(links.options, [
    { number: 1, url: "http://localhost:5173/customer-service/respond?token=abc.def&choice=option-1" },
    { number: 2, url: "http://localhost:5173/customer-service/respond?token=abc.def&choice=option-2" },
  ]);
  assertEquals(links.none, "http://localhost:5173/customer-service/respond?token=abc.def&choice=none");
});

const options = [{ date: "2026-11-24", windowStart: "08:00" }, { date: "2026-11-23", windowStart: "10:00" }];
const links = proposalResponseLinks("https://app.example.com", "abc.def", [1, 2]);

Deno.test("with links, each offered day has its Accept button and the email a None button", () => {
  const email = invitationEmail({
    folio: "CS-2031", homeownerName: "Ana", options, address: "", work: "Shelving", greeting: "Hi,", message: "These:",
    links,
  });
  assertEquals((email.html.match(/>Accept this day</g) ?? []).length, 2);
  assert(email.html.includes('href="https://app.example.com/customer-service/respond?token=abc.def&amp;choice=option-2"'));
  assert(email.html.includes(">None of these days work</a>"));
  assert(email.html.includes("Choose the day that works for you with its button."));
  assert(email.text.includes("Accept option 1: https://app.example.com/customer-service/respond?token=abc.def&choice=option-1"));
  assert(email.text.includes("None of these days work: https://app.example.com/customer-service/respond?token=abc.def&choice=none"));
  // Without links the customer replies, as before.
  const plain = invitationEmail({
    folio: "CS-2031", homeownerName: "Ana", options, address: "", work: "", greeting: "Hi,", message: "These:",
  });
  assert(!plain.html.includes("Accept this day"));
  assert(plain.text.includes("Reply to this email with the option that works for you."));
  // The reminder keeps each day's original button, even when only option 2 is left.
  const reminder = reminderEmail({
    folio: "CS-2031", homeownerName: "Ana", options: [{ ...options[1], number: 2 }], address: "", work: "", links,
  });
  assert(reminder.html.includes("choice=option-2"));
  assert(!reminder.html.includes("choice=option-1"));
  assert(reminder.html.includes(">This day does not work</a>"));
});

const sendBody = (alternatives: unknown) => ({
  requestId: 20,
  expectedRequestUpdatedAt: "2026-11-05T10:00:00Z",
  options: [{ technicianIds: [4], date: "2026-11-24", windowStart: "08:00", workStart: "08:00", travelMinutes: {} }],
  invitation: { greeting: "Hi,", message: "These:" },
  alternatives,
});

Deno.test("a proposal can carry up to three other days, none on an offered day", () => {
  assertEquals(parseSendProposalInput(sendBody(undefined)).alternatives, []);
  const alternative = (date: string) => ({ date, windowStart: "10:00", workStart: "10:15", technicianIds: [4] });
  assertEquals(parseSendProposalInput(sendBody([alternative("2026-11-26"), alternative("2026-11-27")])).alternatives, [
    { date: "2026-11-26", windowStart: "10:00", workStart: "10:15", technicianIds: [4] },
    { date: "2026-11-27", windowStart: "10:00", workStart: "10:15", technicianIds: [4] },
  ]);
  for (const bad of [
    [alternative("2026-11-26"), alternative("2026-11-27"), alternative("2026-11-30"), alternative("2026-12-01")],
    [alternative("2026-11-24")],
    [alternative("2026-11-26"), alternative("2026-11-26")],
    [{ date: "2026-02-30", windowStart: "10:00", workStart: "10:15", technicianIds: [4] }],
    [{ date: "2026-11-26", windowStart: "10:00", workStart: "10:15", technicianIds: [] }],
    "2026-11-26",
  ]) {
    assertThrows(() => parseSendProposalInput(sendBody(bad)), AppointmentInputError);
  }
});

Deno.test("the page accepts a view, an offered day, another day or none", () => {
  assertEquals(parseResponseInput({ action: "view", token: " t.s " }), { action: "view", token: "t.s" });
  assertEquals(parseResponseInput({ action: "accept", token: "t", optionNumber: 2 }), { action: "accept", token: "t", optionNumber: 2 });
  assertEquals(parseResponseInput({ action: "choose", token: "t", alternative: 0 }), { action: "choose", token: "t", alternative: 0 });
  assertEquals(parseResponseInput({ action: "none", token: "t" }), { action: "none", token: "t", bestTime: "", phone: "" });
  assertEquals(
    parseResponseInput({ action: "none", token: "t", bestTime: "  After 5   PM ", phone: "(951) 555-0101" }),
    { action: "none", token: "t", bestTime: "After 5 PM", phone: "(951) 555-0101" },
  );
  for (const bad of [
    { action: "view" },
    { action: "none", token: "t", phone: "call me" },
    { action: "none", token: "t", bestTime: "x".repeat(81) },
    { action: "accept", token: "t", optionNumber: 3 },
    { action: "choose", token: "t", alternative: 5 },
    { action: "delete", token: "t" },
  ]) {
    assertThrows(() => parseResponseInput(bad), AppointmentInputError);
  }
});

// Wednesday 2026-11-25, 9:00 AM in California.
const now = new Date("2026-11-25T17:00:00Z");
const row = (overrides: Partial<CustomerProposalRow> = {}): CustomerProposalRow => ({
  id: 62,
  status: "SENT",
  sender_mailbox: "victor@valtriminc.com",
  accepted_option_id: null,
  alternatives: [
    { date: "2026-11-25", windowStart: "12:00" }, // today: no longer offered
    { date: "2026-11-27", windowStart: "10:00" },
  ],
  service_proposal_options: [
    { id: 72, option_number: 2, window_starts_at: "2026-11-30T16:00:00Z" },
    { id: 71, option_number: 1, window_starts_at: "2026-11-25T16:00:00Z" }, // started at 8:00 AM
  ],
  service_requests: {
    folio: "CS-3049",
    homeowner_name: "Fit Test Customer",
    work_category: "SHELVING",
    service_properties: { address: "200 Test Court", city: "Lake Elsinore", state: "CA", postal_code: "92532" },
  },
  ...overrides,
});

Deno.test("the page shows Valtrim's offer: days, windows, the address and the work, nothing internal", () => {
  const view = customerProposalView(row(), now);
  assertEquals(view.folio, "CS-3049");
  assertEquals(view.customerName, "Fit Test Customer");
  assertEquals(view.address, "200 Test Court, Lake Elsinore, CA 92532");
  assertEquals(view.work, "Shelving");
  assertEquals(view.options.map((option) => [option.number, option.date, option.windowStart, option.started]), [
    [1, "2026-11-25", "08:00", true],
    [2, "2026-11-30", "08:00", false],
  ]);
  assertEquals(view.alternatives, [{ index: 1, date: "2026-11-27", windowStart: "10:00", windowLabel: "10:00 AM–12:00 PM" }]);
  assertEquals(Object.keys(view).sort(), ["address", "alternatives", "customerName", "folio", "options", "status", "work"]);
  // Once answered, no other days are offered and the accepted day is marked.
  const accepted = customerProposalView(row({ status: "ACCEPTED", accepted_option_id: 72 }), now);
  assertEquals(accepted.alternatives, []);
  assertEquals(accepted.options.find((option) => option.accepted)?.number, 2);
  assertNotEquals(accepted.status, "SENT");
});

Deno.test("another day becomes a counter-proposal with its part of the day and a note", () => {
  assertEquals(dayPartForWindow("08:00"), "MORNING");
  assertEquals(dayPartForWindow("10:00"), "MIDDAY");
  assertEquals(dayPartForWindow("12:00"), "AFTERNOON");
  assertEquals(customerAnswerNote({ alternative: { date: "2026-11-27", windowStart: "10:00" } }),
    "From the proposal page: the customer chose Fri, Nov 27, arrival window 10:00 AM–12:00 PM, one of the other days offered.");
  assertEquals(customerAnswerNote({}),
    "From the proposal page: none of the days work for the customer. Call them to find another time.");
  assertEquals(customerAnswerNote({ bestTime: "After 5 PM", phone: "(951) 555-0101" }),
    "From the proposal page: none of the days work for the customer. Call them to find another time. " +
      "Best time to call: After 5 PM. Phone: (951) 555-0101.");
});
