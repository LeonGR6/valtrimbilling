import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { AppointmentInputError } from "./customerServiceAppointments.ts";
import {
  confirmationFailureMessage,
  customerEmailDelivery,
  parseConfirmationInput,
  prepareConfirmation,
} from "./customerServiceConfirmationEmail.ts";
import {
  confirmationEmail,
  confirmationTextProblems,
  defaultConfirmationText,
  mailingAddress,
} from "./customerServiceEmailTemplates.mjs";
import {
  createCustomerServiceMicrosoftGraph,
  MicrosoftGraphSendError,
} from "./customerServiceMicrosoftGraph.ts";

const request = {
  folio: "CS-2031",
  homeowner_name: "Yesenia Hernandez",
  homeowner_email: "customer@example.com",
  description: "Shelving\nreplacement",
  service_properties: { address: "12720 Azure Way-Unit 33", city: "Hawthorne", state: "CA", postal_code: "90250" },
};
const typed = { greeting: "Hi Yesenia,", message: "Thanks for the call.\nSee you then." };

Deno.test("the confirmation keeps the typed greeting and message and fixes the visit details", () => {
  const email = confirmationEmail({
    folio: "CS-2031", homeownerName: "Yesenia Hernandez", date: "2026-11-24", windowStart: "08:00",
    address: mailingAddress({ street: "12720 Azure Way-Unit 33", city: "Hawthorne", state: "CA", postalCode: "90250" }),
    work: "Shelving\nreplacement", greeting: " Hi Yesenia, ", message: "Thanks for the call.\r\n  See you then. ",
    senderName: "Anelda Calvillo",
  });
  assertEquals(email.subject, "Your Valtrim service visit is confirmed for Tue, Nov 24 (CS-2031)");
  assertEquals(email.text, [
    "Hi Yesenia,",
    "",
    "Thanks for the call.",
    "See you then.",
    "",
    "Date: Tuesday, November 24, 2026",
    "Arrival window: 8:00 AM–10:00 AM",
    "Address: 12720 Azure Way-Unit 33, Hawthorne, CA 90250",
    "Work: Shelving replacement",
    "Reference: CS-2031",
    "",
    "If this day no longer works for you, reply to this email.",
    "",
    "Anelda Calvillo",
    "Valtrim Customer Service",
  ].join("\n"));
  assertEquals(defaultConfirmationText({ homeownerName: "" }).greeting, "Hello,");
});

Deno.test("the greeting and message must be filled in, short and without special characters", () => {
  assertEquals(confirmationTextProblems(typed), []);
  assertEquals(confirmationTextProblems({ greeting: " ", message: "" }), ["Enter a greeting.", "Enter a message."]);
  assertEquals(confirmationTextProblems({ greeting: "x".repeat(201), message: "x".repeat(2001) }), [
    "Keep the greeting to 200 characters.", "Keep the message to 2000 characters.",
  ]);
  assertEquals(confirmationTextProblems({ greeting: "Hi\u0007", message: "Bell\u0007" }), [
    "Remove special characters from the greeting.", "Remove special characters from the message.",
  ]);
  assertEquals(parseConfirmationInput(undefined), null);
  assertEquals(parseConfirmationInput(typed), typed);
  assertThrows(() => parseConfirmationInput({ greeting: "", message: "x" }), AppointmentInputError, "Enter a greeting.");
  assertThrows(() => parseConfirmationInput("send"), AppointmentInputError);
});

Deno.test("while testing every customer email goes to the test inbox; real customers only when LIVE", () => {
  assertEquals(customerEmailDelivery({ testRecipient: " tester@example.com ", customerEmails: "LIVE" }),
    { mode: "TEST", recipient: "tester@example.com" });
  assertEquals(customerEmailDelivery({ customerEmails: "LIVE" }), { mode: "LIVE" });
  assertEquals(customerEmailDelivery({}), { mode: "OFF" });

  const base = { input: typed, request, date: "2026-11-24", windowStart: "08:00", senderName: "Anelda Calvillo" };
  const test = prepareConfirmation({ ...base, delivery: { mode: "TEST", recipient: "tester@example.com" } });
  assert(test.send);
  assertEquals([test.to, test.customerEmail, test.testMode], ["tester@example.com", "customer@example.com", true]);
  assertEquals(test.subject, "[TEST for customer@example.com] Your Valtrim service visit is confirmed for Tue, Nov 24 (CS-2031)");

  const live = prepareConfirmation({ ...base, delivery: { mode: "LIVE" } });
  assert(live.send);
  assertEquals([live.to, live.testMode], ["customer@example.com", false]);

  assertEquals(prepareConfirmation({ ...base, delivery: { mode: "OFF" } }), {
    send: false, message: "Customer emails are turned off on the server, so no confirmation was sent.",
  });
  assertEquals(prepareConfirmation({ ...base, request: { ...request, homeowner_email: " " }, delivery: { mode: "LIVE" } }), {
    send: false, message: "This request has no customer email, so no confirmation was sent.",
  });
});

Deno.test("each reason Microsoft gives becomes a message the coordinator can act on", () => {
  const mailbox = "someone@valtriminc.com";
  assertEquals(confirmationFailureMessage(new MicrosoftGraphSendError("FORBIDDEN"), mailbox),
    "someone@valtriminc.com is not allowed to send Customer Service emails. Add it to the senders in Exchange Online.");
  assertEquals(confirmationFailureMessage(new MicrosoftGraphSendError("MAILBOX_NOT_FOUND"), "me@outlook.com"),
    "Microsoft 365 has no mailbox for me@outlook.com. Sign in with your Valtrim email to send customer emails.");
  assertEquals(confirmationFailureMessage(new MicrosoftGraphSendError("REJECTED"), mailbox),
    "Microsoft 365 rejected the email. Check the customer's email address.");
  assertEquals(confirmationFailureMessage(new Error("network"), mailbox),
    "Microsoft 365 did not take the email right now, so it may not have been sent. Confirm the visit with the customer.");
});

const tenantId = "10000000-0000-0000-0000-000000000001";
const clientId = "30000000-0000-0000-0000-000000000003";
const auth = () => Response.json({ access_token: "FAKE-ACCESS-TOKEN", token_type: "Bearer", expires_in: 3600 });
function graph(replies: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createCustomerServiceMicrosoftGraph({
    tenantId, clientId, clientSecret: "FAKE-TEST-SECRET", diagnose: () => {},
    fetcher: (async (input, init = {}) => {
      calls.push({ url: String(input), init });
      const reply = replies.shift();
      if (!reply) throw new Error("Unexpected external request in a simulation.");
      return reply;
    }) as typeof fetch,
  });
  return { client, calls };
}
const mail = { to: "tester@example.com", subject: "Subject", text: "Body" };

Deno.test("an email is sent as plain text from the coordinator's mailbox and kept in Sent Items", async () => {
  const { client, calls } = graph([auth(), new Response(null, { status: 202 })]);
  await client.sendMail("anelda@valtriminc.com", mail);
  assertEquals(calls[1].url, "https://graph.microsoft.com/v1.0/users/anelda%40valtriminc.com/sendMail");
  assertEquals(calls[1].init.method, "POST");
  assertEquals(JSON.parse(String(calls[1].init.body)), {
    message: {
      subject: "Subject",
      body: { contentType: "Text", content: "Body" },
      toRecipients: [{ emailAddress: { address: "tester@example.com" } }],
    },
    saveToSentItems: true,
  });
});

Deno.test("only an expired token is retried; other failures are never resent", async () => {
  const retried = graph([auth(), new Response(null, { status: 401 }), auth(), new Response(null, { status: 202 })]);
  await retried.client.sendMail("anelda@valtriminc.com", mail);
  assertEquals(retried.calls.length, 4);

  for (const [status, code] of [[403, "FORBIDDEN"], [404, "MAILBOX_NOT_FOUND"], [400, "REJECTED"], [429, "THROTTLED"], [503, "UNAVAILABLE"]] as const) {
    const failed = graph([auth(), Response.json({ error: { code: "Any", message: "Hidden" } }, { status })]);
    const error = await assertRejects(() => failed.client.sendMail("anelda@valtriminc.com", mail), MicrosoftGraphSendError);
    assertEquals([error.code, failed.calls.length], [code, 2]);
  }
});
