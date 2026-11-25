import { assert, assertEquals } from "@std/assert";
import { setCustomerServiceHolidays } from "./customerServiceScheduling.mjs";
import { visitCalendarFile } from "./customerServiceVisitCalendar.ts";
import {
  dueVisitReminders,
  prepareVisitReminder,
  previousBusinessDay,
  type VisitReminderRow,
} from "./customerServiceVisitReminders.ts";

// Friday 2026-11-27, 3:00 PM in California.
const now = new Date("2026-11-27T23:00:00Z");
const row = (overrides: Partial<VisitReminderRow> = {}): VisitReminderRow => ({
  id: 293,
  request_id: 3049,
  state: "SCHEDULED",
  is_current: true,
  // Monday 30, 10:00 AM.
  window_starts_at: "2026-11-30T18:00:00Z",
  created_at: "2026-11-24T18:00:00Z",
  visit_reminder_sent_at: null,
  ...overrides,
});

Deno.test("the business day before a visit skips the weekend", () => {
  assertEquals(previousBusinessDay("2026-11-30"), "2026-11-27"); // Monday → Friday
  assertEquals(previousBusinessDay("2026-12-01"), "2026-11-30"); // Tuesday → Monday
  assertEquals(previousBusinessDay("bad"), "");
});

Deno.test("the business day before a visit skips holidays", () => {
  setCustomerServiceHolidays([{ date: "2026-11-26", name: "Thanksgiving Day" }]);
  try {
    // A visit the Friday after Thanksgiving is reminded on Wednesday.
    assertEquals(previousBusinessDay("2026-11-27"), "2026-11-25");
  } finally {
    setCustomerServiceHolidays([]);
  }
});

Deno.test("a visit is reminded the business day before, from 3:00 PM to 6:00 PM, once", () => {
  assertEquals(dueVisitReminders([row()], now), [{ appointmentId: 293, requestId: 3049, date: "2026-11-30", windowStart: "10:00" }]);
  // 2:59 PM, 6:00 PM, and Saturday: not now.
  assertEquals(dueVisitReminders([row()], new Date("2026-11-27T22:59:00Z")), []);
  assertEquals(dueVisitReminders([row()], new Date("2026-11-28T02:00:00Z")), []);
  assertEquals(dueVisitReminders([row()], new Date("2026-11-28T23:00:00Z")), []);
  for (const skipped of [
    row({ visit_reminder_sent_at: "2026-11-27T23:00:00Z" }),
    row({ state: "CANCELLED" }),
    row({ is_current: false }),
    row({ window_starts_at: "2026-12-01T16:00:00Z" }), // Tuesday: reminded on Monday
    row({ created_at: "2026-11-27T23:00:00Z" }), // booked at 3:00 PM: the confirmation is enough
  ]) {
    assertEquals(dueVisitReminders([skipped], now), []);
  }
});

const request = {
  folio: "CS-3049",
  homeowner_name: "Fit Test Customer",
  homeowner_email: "customer@example.com",
  work_category: "SHELVING",
  service_properties: { address: "200 Test Court", city: "Lake Elsinore", state: "CA", postal_code: "92532" },
};

Deno.test("the visit reminder repeats the visit details, to the test inbox while testing", () => {
  const live = prepareVisitReminder({ request, date: "2026-11-30", windowStart: "10:00", delivery: { mode: "LIVE" } });
  assert(live.send);
  assertEquals(live.to, "customer@example.com");
  assertEquals(live.subject, "Reminder: your Valtrim service visit is on Mon, Nov 30 (CS-3049)");
  assertEquals(live.text, [
    "Hi Fit Test Customer,",
    "This is a reminder of your upcoming Valtrim service visit. Here are the details:",
    "Date: Monday, November 30, 2026\nArrival window: 10:00 AM–12:00 PM\n" +
    "Address: 200 Test Court, Lake Elsinore, CA 92532\nWork: Shelving\nReference: CS-3049",
  ].join("\n\n"));
  const test = prepareVisitReminder({
    request, date: "2026-11-30", windowStart: "10:00", delivery: { mode: "TEST", recipient: "test@example.com" },
  });
  assert(test.send);
  assertEquals(test.to, "test@example.com");
  assert(test.subject.startsWith("[TEST for customer@example.com] Reminder:"));
  assertEquals(prepareVisitReminder({ request: { ...request, homeowner_email: " " }, date: "2026-11-30", windowStart: "10:00",
    delivery: { mode: "LIVE" } }).send, false);
  assertEquals(prepareVisitReminder({ request, date: "2026-11-30", windowStart: "10:00", delivery: { mode: "OFF" } }).send, false);
});

Deno.test("the confirmation's calendar file holds the arrival window at the property", () => {
  const file = visitCalendarFile({
    folio: "CS-3049", date: "2026-11-30", windowStart: "10:00", address: "200 Test Court, Lake Elsinore, CA 92532",
    work: "Shelving", now: new Date("2026-11-24T18:00:00Z"),
  });
  assert(file);
  assertEquals([file.name, file.contentType], ["valtrim-service-visit.ics", "text/calendar"]);
  const lines = file.content.split("\r\n");
  assertEquals(lines.slice(0, 6), ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Valtrim//Customer Service//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT"]);
  assert(lines.includes("UID:CS-3049-20261130-1000@valtriminc.com"));
  // 10:00 AM to 12:00 PM PST is 18:00 to 20:00 UTC.
  assert(lines.includes("DTSTART:20261130T180000Z"));
  assert(lines.includes("DTEND:20261130T200000Z"));
  assert(lines.includes("SUMMARY:Valtrim service visit (CS-3049)"));
  assert(lines.includes("LOCATION:200 Test Court\\, Lake Elsinore\\, CA 92532"));
  assert(file.content.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  // Long lines are folded at 75 octets.
  assert(lines.every((line) => new TextEncoder().encode(line).length <= 75));
  assertEquals(lines.join("\r\n").replaceAll("\r\n ", "").includes(
    "DESCRIPTION:Arrival window: 10:00 AM to 12:00 PM. Work: Shelving. Reference: CS-3049. Reply to the confirmation email to reach your coordinator.",
  ), true);
  assertEquals(visitCalendarFile({ folio: "CS-1", date: "2026-11-30", windowStart: "09:00", address: "", work: "" }), null);
});
