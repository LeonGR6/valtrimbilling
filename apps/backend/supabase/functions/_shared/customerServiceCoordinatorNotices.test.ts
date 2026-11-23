import { assert, assertEquals, assertThrows } from "@std/assert";
import { coordinatorNoticeEmail } from "./customerServiceEmailTemplates.mjs";
import {
  dueCoordinatorNotices,
  type NoticeProposalRow,
  prepareCoordinatorNotice,
} from "./customerServiceCoordinatorNotices.ts";

// Friday 2026-11-27, 9:00 AM in California.
const now = new Date("2026-11-27T17:00:00Z");
const row = (overrides: Partial<NoticeProposalRow> = {}): NoticeProposalRow => ({
  id: 70,
  request_id: 3049,
  status: "SENT",
  sender_mailbox: "anelda@valtriminc.com",
  // Wednesday 9:00 AM: exactly 48 hours before.
  sent_at: "2026-11-25T17:00:00Z",
  builder_contacted_at: null,
  builder_call_notified_at: null,
  days_passed_notified_at: null,
  // Monday 30, 8:00 AM.
  service_proposal_options: [{ window_starts_at: "2026-11-30T16:00:00Z" }],
  ...overrides,
});
const ids = (due: ReturnType<typeof dueCoordinatorNotices>) => ({
  builderCall: due.builderCall.map((entry) => entry.id),
  daysPassed: due.daysPassed.map((entry) => entry.id),
});

Deno.test("the coordinator is emailed to call the Builder 48 hours after sending, once", () => {
  assertEquals(ids(dueCoordinatorNotices([row()], now)), { builderCall: [70], daysPassed: [] });
  for (const waiting of [
    row({ sent_at: "2026-11-25T17:01:00Z" }), // one minute short
    row({ builder_call_notified_at: "2026-11-27T16:00:00Z" }), // already emailed
    row({ builder_contacted_at: "2026-11-27T16:30:00Z" }), // already called
    row({ status: "ACCEPTED" }),
  ]) {
    assertEquals(ids(dueCoordinatorNotices([waiting], now)), { builderCall: [], daysPassed: [] });
  }
});

Deno.test("once every offered day started, the coordinator is told the days passed instead", () => {
  const passed = row({ service_proposal_options: [{ window_starts_at: "2026-11-27T16:00:00Z" }] }); // today 8:00 AM
  assertEquals(ids(dueCoordinatorNotices([passed], now)), { builderCall: [], daysPassed: [70] });
  assertEquals(ids(dueCoordinatorNotices([{ ...passed, days_passed_notified_at: "2026-11-27T16:15:00Z" }], now)),
    { builderCall: [], daysPassed: [] });
  // One day still ahead: not passed yet.
  const oneAhead = row({
    sent_at: "2026-11-26T17:00:00Z",
    service_proposal_options: [{ window_starts_at: "2026-11-27T16:00:00Z" }, { window_starts_at: "2026-11-30T16:00:00Z" }],
  });
  assertEquals(ids(dueCoordinatorNotices([oneAhead], now)), { builderCall: [], daysPassed: [] });
});

Deno.test("coordinator notices wait for 8:00 AM to 6:00 PM in California", () => {
  assertEquals(ids(dueCoordinatorNotices([row()], new Date("2026-11-28T02:00:00Z"))), { builderCall: [], daysPassed: [] });
  assertEquals(ids(dueCoordinatorNotices([row()], new Date("2026-11-27T15:59:00Z"))), { builderCall: [], daysPassed: [] });
});

Deno.test("a notice goes to the coordinator's mailbox, or to the test inbox while testing", () => {
  const email = { subject: "CS-3049: call the customer", text: "Call them.", html: "<p>Call them.</p>" };
  assertEquals(prepareCoordinatorNotice({ mailbox: " anelda@valtriminc.com ", email, delivery: { mode: "LIVE" } }), {
    to: "anelda@valtriminc.com", customerEmail: "anelda@valtriminc.com", testMode: false, ...email,
  });
  const test = prepareCoordinatorNotice({ mailbox: "anelda@valtriminc.com", email, delivery: { mode: "TEST", recipient: "test@example.com" } });
  assertEquals(test?.to, "test@example.com");
  assertEquals(test?.subject, "[TEST for anelda@valtriminc.com] CS-3049: call the customer");
  assertEquals(prepareCoordinatorNotice({ mailbox: "anelda@valtriminc.com", email, delivery: { mode: "OFF" } }), null);
  assertEquals(prepareCoordinatorNotice({ mailbox: " ", email, delivery: { mode: "LIVE" } }), null);
});

Deno.test("each notice says what to do, with the details that help do it", () => {
  const base = { folio: "CS-3049", customerName: "Fit Test Customer", address: "200 Test Court, Lake Elsinore, CA 92532" };
  const picked = coordinatorNoticeEmail({ ...base, kind: "CUSTOMER_PICKED_DAY", date: "2026-12-01", windowStart: "10:00" });
  assertEquals(picked.subject, "CS-3049: the customer picked another day (Tue, Dec 1)");
  assert(picked.text.startsWith("None of the offered days worked for Fit Test Customer, who picked Tuesday, December 1, 2026, arrival window 10:00 AM–12:00 PM"));
  const call = coordinatorNoticeEmail({ ...base, kind: "CALL_CUSTOMER", bestTime: "After 5 PM", phone: "(951) 555-0101" });
  assertEquals(call.subject, "CS-3049: call the customer");
  assert(call.text.endsWith("Customer: Fit Test Customer\nAddress: 200 Test Court, Lake Elsinore, CA 92532\n" +
    "Best time: After 5 PM\nPhone: (951) 555-0101\nReference: CS-3049"));
  const builder = coordinatorNoticeEmail({
    ...base, kind: "BUILDER_CALL",
    builder: { name: "Lennar", superintendent: "Sam <Super>", phone: "(951) 555-0199", email: "" },
  });
  assertEquals(builder.subject, "CS-3049: no answer after 48 hours, call the Builder");
  assert(builder.text.includes("Builder: Lennar\nContact: Sam <Super>\nPhone: (951) 555-0199\nReference"));
  assert(builder.html.includes("Sam &lt;Super&gt;"));
  assert(!builder.text.includes("Email:"));
  const passed = coordinatorNoticeEmail({ ...base, kind: "DAYS_PASSED" });
  assertEquals(passed.subject, "CS-3049: the offered days passed without an answer");
  assertThrows(() => coordinatorNoticeEmail({ ...base, kind: "OTHER" }));
});
