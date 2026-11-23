import { assert, assertEquals } from "@std/assert";
import { reminderEmail } from "./customerServiceEmailTemplates.mjs";
import {
  dueReminders,
  prepareReminder,
  reminderCutoff,
  type ReminderProposalRow,
} from "./customerServiceProposalReminders.ts";

// Wednesday 2026-11-25, 9:00 AM in California.
const now = new Date("2026-11-25T17:00:00Z");
const row = (overrides: Partial<ReminderProposalRow> = {}): ReminderProposalRow => ({
  id: 43,
  request_id: 1023,
  status: "SENT",
  sender_mailbox: "victor@valtriminc.com",
  // Tuesday 9:00 AM: exactly 24 hours before.
  sent_at: "2026-11-24T17:00:00Z",
  reminder_sent_at: null,
  created_by: "00000000-0000-0000-0000-000000000001",
  service_proposal_options: [
    // Friday 27, 8:00 AM and Monday 30, 10:00 AM.
    { option_number: 2, window_starts_at: "2026-11-30T18:00:00Z" },
    { option_number: 1, window_starts_at: "2026-11-27T16:00:00Z" },
  ],
  ...overrides,
});

Deno.test("a proposal gets its reminder 24 calendar hours after it was sent", () => {
  assertEquals(reminderCutoff(now).toISOString(), "2026-11-24T17:00:00.000Z");
  assertEquals(dueReminders([row()], now), [{
    proposalId: 43,
    requestId: 1023,
    senderMailbox: "victor@valtriminc.com",
    createdBy: "00000000-0000-0000-0000-000000000001",
    options: [
      { number: 1, date: "2026-11-27", windowStart: "08:00" },
      { number: 2, date: "2026-11-30", windowStart: "10:00" },
    ],
  }]);
  // One minute short of 24 hours, already reminded, or answered: nothing yet.
  assertEquals(dueReminders([row({ sent_at: "2026-11-24T17:01:00Z" })], now), []);
  assertEquals(dueReminders([row({ reminder_sent_at: "2026-11-25T16:45:00Z" })], now), []);
  assertEquals(dueReminders([row({ status: "ACCEPTED" })], now), []);
});

Deno.test("the reminder lists only the days that have not started, and none when all have", () => {
  const firstStarted = row({
    service_proposal_options: [
      { option_number: 1, window_starts_at: "2026-11-25T16:00:00Z" }, // today 8:00 AM, started
      { option_number: 2, window_starts_at: "2026-11-30T18:00:00Z" },
    ],
  });
  assertEquals(dueReminders([firstStarted], now)[0].options, [{ number: 2, date: "2026-11-30", windowStart: "10:00" }]);
  const allStarted = row({ service_proposal_options: [{ option_number: 1, window_starts_at: "2026-11-25T16:00:00Z" }] });
  assertEquals(dueReminders([allStarted], now), []);
});

const request = {
  folio: "CS-2023",
  homeowner_name: "Charline",
  homeowner_email: "customer@example.com",
  description: "General fix",
  service_properties: { address: "5242 Guava Lane", city: "Banning", state: "CA", postal_code: "92220" },
};
const options = [{ number: 1, date: "2026-11-27", windowStart: "08:00" }, { number: 2, date: "2026-11-30", windowStart: "10:00" }];

Deno.test("the reminder is the invitation with a fixed text", () => {
  const email = reminderEmail({
    folio: "CS-2023", homeownerName: "Charline", options, address: "", work: "General fix",
  });
  assertEquals(email.subject, "Reminder: choose a day for your Valtrim service visit (CS-2023)");
  assert(email.text.startsWith("Hi Charline,\n\nWe have not heard back about your service visit yet, so we are still holding these times for you:"));
  assert(email.html.includes(">Reminder: choose a day for your service visit</h1>"));
  assert(email.html.includes(">Option 2</div>"));
  // A single remaining day keeps the single-day wording but names it.
  const single = reminderEmail({
    folio: "CS-2023", homeownerName: "", options: [options[1]], address: "", work: "",
  });
  assertEquals(single.subject, "Reminder: can we visit on Mon, Nov 30? Your Valtrim service visit (CS-2023)");
  assert(single.text.includes("still holding this time for you"));

  const test = prepareReminder({
    request, options, delivery: { mode: "TEST", recipient: "tester@example.com" },
  });
  assert(test.send);
  assertEquals([test.to, test.testMode], ["tester@example.com", true]);
  assertEquals(test.subject, "[TEST for customer@example.com] Reminder: choose a day for your Valtrim service visit (CS-2023)");
  assert(!prepareReminder({ request, options, delivery: { mode: "OFF" } }).send);
  assert(!prepareReminder({
    request: { ...request, homeowner_email: null }, options, delivery: { mode: "LIVE" },
  }).send);
});
