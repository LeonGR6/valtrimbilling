import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  AppointmentInputError,
  type AppointmentRow,
  californiaDayRange,
  parseRegisterInput,
  type RegisterAppointmentInput,
  type RequestRow,
  statusForDatabaseError,
  validateRegistration,
} from "./customerServiceAppointments.ts";
import { californiaClockAt, californiaInstant } from "./customerServiceScheduling.mjs";

// Friday 2026-11-06, 9:00 AM in California. The visit is Monday 2026-11-09 (PST).
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
const input = (overrides: Partial<RegisterAppointmentInput> = {}): RegisterAppointmentInput => ({
  requestId: 20, expectedRequestUpdatedAt: "2026-11-05T10:00:00Z", technicianIds: [4],
  date: "2026-11-09", windowStart: "10:00", workStart: "10:00", travelMinutes: {},
  acceptance: "CUSTOMER_ACCEPTED_PROPOSAL", ...overrides,
});
// 08:00–08:30 work for Tech One, so the technician is free from 08:40.
const earlier: AppointmentRow = {
  id: 7, request_id: 10, technician_ids: [4], window_starts_at: "2026-11-09T16:00:00Z",
  starts_at: "2026-11-09T16:00:00Z", ends_at: "2026-11-09T16:30:00Z", pickup_minutes: 10,
  service_requests: { folio: "SR-00000010" },
};

Deno.test("California wall times convert to UTC across standard and daylight time", () => {
  assertEquals(californiaInstant("2026-11-09", "08:00")?.toISOString(), "2026-11-09T16:00:00.000Z");
  assertEquals(californiaInstant("2026-07-06", "08:00")?.toISOString(), "2026-07-06T15:00:00.000Z");
  assertEquals(californiaClockAt(new Date("2026-11-09T16:30:00Z")).time, "08:30");
  // The day DST ends is 25 hours long.
  assertEquals(californiaDayRange("2026-11-01"), {
    start: "2026-11-01T07:00:00.000Z", end: "2026-11-02T08:00:00.000Z",
  });
});

Deno.test("input parsing rejects missing versions, bad technicians and invalid travel", () => {
  const body = { ...input() };
  assertEquals(parseRegisterInput(body).technicianIds, [4]);
  for (const bad of [
    { ...body, expectedRequestUpdatedAt: undefined },
    { ...body, technicianIds: [] },
    { ...body, technicianIds: ["prototype-Jorge Murillo"] },
    { ...body, travelMinutes: { "10>20": -1 } },
    { ...body, travelMinutes: { "a>b": 5 } },
    { ...body, acceptance: "AUTOMATIC" },
  ]) {
    assertThrows(() => parseRegisterInput(bad), AppointmentInputError);
  }
});

Deno.test("a valid visit becomes RPC arguments with UTC instants and the expected day", () => {
  const result = validateRegistration({
    input: input({ travelMinutes: { "10>20": 30 } }), request, technicians, dayAppointments: [earlier], now,
  });
  assertEquals(result.errors, []);
  assertEquals(result.rpcArgs?.p_expected_appointment_ids, [7]);
  assertEquals(result.rpcArgs?.p_appointment, {
    technicianIds: [4],
    windowStartsAt: "2026-11-09T18:00:00.000Z", windowEndsAt: "2026-11-09T20:00:00.000Z",
    startsAt: "2026-11-09T18:00:00.000Z", endsAt: "2026-11-09T18:45:00.000Z",
    pickupMinutes: 10, acceptance: "CUSTOMER_ACCEPTED_PROPOSAL",
  });
  assertEquals(result.rpcArgs?.p_travel, [{ fromRequestId: 10, toRequestId: 20, minutes: 30 }]);
});

Deno.test("pending travel blocks registration although it only warns in a draft", () => {
  const result = validateRegistration({ input: input(), request, technicians, dayAppointments: [earlier], now });
  assert(!result.rpcArgs);
  assert(result.errors.some((error) => error.message.startsWith("Travel time pending")));
});

Deno.test("the server rejects conflicts, short travel, late pickup and the wrong crew", () => {
  const cases: [Partial<RegisterAppointmentInput>, Partial<RequestRow>, string][] = [
    [{ windowStart: "08:00", workStart: "08:15" }, {}, "internal work conflict"],
    [{ travelMinutes: { "10>20": 90 } }, {}, "cannot reach this visit"],
    [{ workStart: "11:10" }, {}, "Work and pickup must finish before the customer window closes at 12:00."],
    [{}, { crew_size: 2 }, "This work requires 2 people; 1 selected."],
    [{ technicianIds: [4, 4] }, {}, "Select distinct active technicians"],
    [{ technicianIds: [99] }, {}, "Select distinct active technicians"],
    [{ date: "2026-11-07" }, {}, "Monday through Friday"],
    [{}, { workflow_stage: "CONFIRMED" }, "Only an open request"],
    [{}, { valtrim_items_confirmed: false }, "approve the request information"],
  ];
  for (const [inputOverrides, requestOverrides, expected] of cases) {
    const result = validateRegistration({
      input: input(inputOverrides), request: { ...request, ...requestOverrides }, technicians,
      dayAppointments: [earlier], now,
    });
    assert(!result.rpcArgs, expected);
    assert(result.errors.some((error) => error.message.includes(expected)), `${expected}: ${JSON.stringify(result.errors)}`);
  }
});

Deno.test("a crew of two is checked against both technicians' days", () => {
  const result = validateRegistration({
    input: input({ technicianIds: [4, 5], windowStart: "08:00", workStart: "08:00" }),
    request: { ...request, crew_size: 2 }, technicians, dayAppointments: [earlier], now,
  });
  assert(result.errors.some((error) => error.message.startsWith("Tech One has an internal work conflict")));
  assert(!result.errors.some((error) => error.message.startsWith("Tech Two")));
});

Deno.test("database errors map to planner statuses", () => {
  assertEquals(statusForDatabaseError("40001"), 409);
  assertEquals(statusForDatabaseError("55000"), 409);
  assertEquals(statusForDatabaseError("42501"), 403);
  assertEquals(statusForDatabaseError("23514"), 422);
  assertEquals(statusForDatabaseError("XX000"), 500);
});
