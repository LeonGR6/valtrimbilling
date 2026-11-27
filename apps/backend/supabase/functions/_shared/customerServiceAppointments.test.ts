import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  AppointmentInputError,
  type AppointmentRow,
  californiaDayRange,
  changedTravelLegs,
  type HoldRow,
  parseCancelInput,
  parseCloseInput,
  parseCustomerEmail,
  parseMoveInput,
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

Deno.test("a customer email corrected in Send to customer is trimmed, lowercased and checked", () => {
  assertEquals(parseCustomerEmail("  Right@Example.COM "), "right@example.com");
  assertEquals(parseCustomerEmail(undefined), undefined);
  assertEquals(parseCustomerEmail(""), undefined);
  for (const bad of ["not-an-email", "a@b", "two@@example.com", "with space@example.com", 42, `${"a".repeat(250)}@x.co`]) {
    assertThrows(() => parseCustomerEmail(bad), AppointmentInputError, "Enter a valid customer email.");
  }
  // Register carries it only when it was given.
  assertEquals(parseRegisterInput({ ...input(), customerEmail: "Right@Example.com" }).customerEmail, "right@example.com");
  assertEquals("customerEmail" in parseRegisterInput(input()), false);
  assertThrows(() => parseRegisterInput({ ...input(), customerEmail: "wrong" }), AppointmentInputError);
});

Deno.test("a valid visit becomes RPC arguments with UTC instants and the expected day", () => {
  const result = validateRegistration({
    input: input({ travelMinutes: { "10>20": 30 } }), request, technicians, dayAppointments: [earlier], now,
  });
  assertEquals(result.errors, []);
  assertEquals(result.rpcArgs?.p_expected_appointment_ids, [7]);
  assertEquals(result.rpcArgs?.p_expected_option_ids, []);
  assertEquals(result.rpcArgs?.p_appointment, {
    technicianIds: [4],
    windowStartsAt: "2026-11-09T18:00:00.000Z", windowEndsAt: "2026-11-09T20:00:00.000Z",
    startsAt: "2026-11-09T18:00:00.000Z", endsAt: "2026-11-09T18:45:00.000Z",
    pickupMinutes: 10, acceptance: "CUSTOMER_ACCEPTED_PROPOSAL",
  });
  assertEquals(result.rpcArgs?.p_travel, [{ fromRequestId: 10, toRequestId: 20, minutes: 30 }]);
});

// A sent proposal holds 08:00–08:30 for Tech One on the same day until the customer answers.
const held: HoldRow = {
  option_id: 31, request_id: 11, folio: "SR-00000011", technician_ids: [4],
  starts_at: "2026-11-09T16:00:00Z", ends_at: "2026-11-09T16:30:00Z", pickup_minutes: 10,
};

Deno.test("a held proposal option occupies its technician like an appointment", () => {
  const conflict = validateRegistration({
    input: input({ windowStart: "08:00", workStart: "08:15" }), request, technicians, dayAppointments: [],
    dayHolds: [held], now,
  });
  assert(!conflict.rpcArgs);
  assert(conflict.errors.some((error) => error.message.includes("is already busy with SR-00000011")));

  const after = validateRegistration({
    input: input({ travelMinutes: { "11>20": 30 } }), request, technicians, dayAppointments: [], dayHolds: [held], now,
  });
  assertEquals(after.errors, []);
  assertEquals(after.rpcArgs?.p_expected_appointment_ids, []);
  assertEquals(after.rpcArgs?.p_expected_option_ids, [31]);
  assertEquals(after.rpcArgs?.p_travel, [{ fromRequestId: 11, toRequestId: 20, minutes: 30 }]);
});

Deno.test("pending travel blocks registration although it only warns in a draft", () => {
  const result = validateRegistration({ input: input(), request, technicians, dayAppointments: [earlier], now });
  assert(!result.rpcArgs);
  assert(result.errors.some((error) => error.message.startsWith("Travel time from")));
});

Deno.test("the server rejects conflicts, short travel, late pickup and the wrong crew", () => {
  const cases: [Partial<RegisterAppointmentInput>, Partial<RequestRow>, string][] = [
    [{ windowStart: "08:00", workStart: "08:15" }, {}, "is already busy with"],
    [{ travelMinutes: { "10>20": 90 } }, {}, "cannot reach this visit"],
    [{ workStart: "11:10" }, {}, "Work and pickup must finish before the customer window closes at 12:00 PM."],
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

Deno.test("a date after the due date is blocked only while on-time days remain", () => {
  // Due Friday 2026-11-06 (today): Monday is late and on-time days remain → blocked.
  const blocked = validateRegistration({
    input: input({ travelMinutes: { "10>20": 30 } }), request: { ...request, due_on: "2026-11-06" },
    technicians, dayAppointments: [earlier], now,
  });
  assert(!blocked.rpcArgs);
  assert(blocked.errors.some((error) => error.message.startsWith("This date is after the due date (Fri, Nov 6).")));

  // Already overdue (due 2026-09-04): registering stays possible.
  const overdue = validateRegistration({
    input: input({ travelMinutes: { "10>20": 30 } }), request: { ...request, due_on: "2026-09-04" },
    technicians, dayAppointments: [earlier], now,
  });
  assertEquals(overdue.errors, []);
  assert(overdue.rpcArgs);
});

Deno.test("a completed window no longer blocks or needs travel, but stays in the fingerprint", () => {
  const result = validateRegistration({
    input: input({ windowStart: "08:00", workStart: "08:15" }), request, technicians,
    dayAppointments: [{ ...earlier, state: "COMPLETED" }], now,
  });
  assertEquals(result.errors, []);
  assertEquals(result.rpcArgs?.p_expected_appointment_ids, [7]);
  assertEquals(result.rpcArgs?.p_travel, []);
});

Deno.test("a crew of two is checked against both technicians' days", () => {
  const result = validateRegistration({
    input: input({ technicianIds: [4, 5], windowStart: "08:00", workStart: "08:00" }),
    request: { ...request, crew_size: 2 }, technicians, dayAppointments: [earlier], now,
  });
  assert(result.errors.some((error) => error.message.startsWith("Tech One is already busy with")));
  assert(!result.errors.some((error) => error.message.startsWith("Tech Two")));
});

Deno.test("unchanged stored travel is not rewritten, so a Routes API source survives", () => {
  const legs = [
    { fromRequestId: 10, toRequestId: 20, minutes: 18 },
    { fromRequestId: 20, toRequestId: 30, minutes: 25 },
    { fromRequestId: 30, toRequestId: 40, minutes: 5 },
  ];
  const stored = [
    { from_request_id: 10, to_request_id: 20, minutes: 18 },
    { from_request_id: 20, to_request_id: 30, minutes: 22 },
  ];
  assertEquals(changedTravelLegs(legs, stored), [legs[1], legs[2]]);
});

Deno.test("database errors map to planner statuses", () => {
  assertEquals(statusForDatabaseError("40001"), 409);
  assertEquals(statusForDatabaseError("55000"), 409);
  assertEquals(statusForDatabaseError("42501"), 403);
  assertEquals(statusForDatabaseError("23514"), 422);
  assertEquals(statusForDatabaseError("XX000"), 500);
});

// Reschedule block (27 Nov 2026). The visit being moved: Tech One, Monday 10:00–10:45.
const movingVisit: AppointmentRow = {
  id: 11, request_id: 20, technician_ids: [4], window_starts_at: "2026-11-09T18:00:00Z",
  starts_at: "2026-11-09T18:00:00Z", ends_at: "2026-11-09T18:45:00Z", pickup_minutes: 10,
  service_requests: { folio: "SR-00000020" },
};
const confirmed: RequestRow = { ...request, workflow_stage: "CONFIRMED" };
const moveFields = {
  requestId: 20, expectedRequestUpdatedAt: "2026-11-05T10:00:00Z", technicianIds: [4],
  date: "2026-11-09", windowStart: "10:00", workStart: "10:30", travelMinutes: { "10>20": 30 },
};

Deno.test("a moved visit does not occupy its own slot and leaves the fingerprint", () => {
  // The same slot taken by another request's visit is a conflict.
  const taken = validateRegistration({
    input: input({ workStart: "10:30", travelMinutes: { "10>20": 30 } }), request,
    technicians, dayAppointments: [earlier, { ...movingVisit, id: 12, request_id: 30 }], now,
  });
  assert(!taken.rpcArgs);

  const moved = validateRegistration({
    input: moveFields, request: confirmed, technicians, dayAppointments: [earlier, movingVisit], now,
    movingAppointmentId: 11,
  });
  assertEquals(moved.errors, []);
  assertEquals(moved.warnings, []);
  assertEquals(moved.rpcArgs?.p_expected_appointment_ids, [7]);
  assertEquals(moved.rpcArgs?.p_appointment.startsAt, "2026-11-09T18:30:00.000Z");
  assertEquals("acceptance" in (moved.rpcArgs?.p_appointment ?? {}), false, "the RPC keeps the old acceptance");
});

Deno.test("only a confirmed visit moves, also under way, and after the due date it only warns", () => {
  const ready = validateRegistration({
    input: moveFields, request, technicians, dayAppointments: [earlier, movingVisit], now, movingAppointmentId: 11,
  });
  assertEquals(ready.errors.map((error) => error.message), ["Only a confirmed visit can be moved."]);

  const working = validateRegistration({
    input: moveFields, request: { ...confirmed, workflow_stage: "WORKING" }, technicians,
    dayAppointments: [earlier, movingVisit], now, movingAppointmentId: 11,
  });
  assert(working.rpcArgs);

  // Due Friday (today) while on-time days remain: registering is blocked, moving only warns (P3).
  const late = validateRegistration({
    input: moveFields, request: { ...confirmed, due_on: "2026-11-06" }, technicians,
    dayAppointments: [earlier, movingVisit], now, movingAppointmentId: 11,
  });
  assertEquals(late.errors, []);
  assert(late.rpcArgs);
  assert(late.warnings.some((warning) => warning.message.startsWith("This date is after the due date (Fri, Nov 6).")));
});

Deno.test("moving, cancelling and closing check the reason with the RPC's words", () => {
  const move = {
    ...moveFields, appointmentId: 11, expectedAppointmentUpdatedAt: "2026-11-05T09:00:00Z",
    reason: "CUSTOMER_ASKED", note: "  Thursday works better ",
  };
  assertEquals(parseMoveInput(move).note, "Thursday works better");
  assertEquals(parseMoveInput({ ...move, note: "   " }).note, null);
  assertThrows(() => parseMoveInput({ ...move, reason: "CUSTOMER_CANCELLED" }), AppointmentInputError, "Choose why the visit moves.");
  assertThrows(() => parseMoveInput({ ...move, reason: "OTHER", note: "" }), AppointmentInputError,
    "Describe the reason in 500 characters or fewer.");
  assertThrows(() => parseMoveInput({ ...move, note: "x".repeat(501) }), AppointmentInputError);
  assertThrows(() => parseMoveInput({ ...move, appointmentId: 0 }), AppointmentInputError, "A valid appointmentId is required.");
  assertThrows(() => parseMoveInput({ ...move, expectedAppointmentUpdatedAt: "soon" }), AppointmentInputError,
    "The visit version is required.");

  const cancel = { appointmentId: 11, expectedAppointmentUpdatedAt: "2026-11-05T09:00:00Z", reason: "BUILDER_CANCELLED" };
  assertEquals(parseCancelInput(cancel), {
    appointmentId: 11, expectedAppointmentUpdatedAt: "2026-11-05T09:00:00Z", reason: "BUILDER_CANCELLED",
    note: null, closeRequest: false, duplicateOfRequestId: null,
  });
  assertThrows(() => parseCancelInput({ ...cancel, reason: "WEATHER" }), AppointmentInputError, "Choose why the visit is cancelled.");
  assertThrows(() => parseCancelInput({ ...cancel, reason: "DUPLICATE", duplicateOfRequestId: 30 }), AppointmentInputError,
    "A duplicate closes the request.");
  assertThrows(() => parseCancelInput({ ...cancel, reason: "DUPLICATE", closeRequest: true }), AppointmentInputError,
    "A duplicate needs the original request");
  assertEquals(parseCancelInput({ ...cancel, reason: "DUPLICATE", closeRequest: true, duplicateOfRequestId: 30 }).duplicateOfRequestId, 30);
  assertThrows(() => parseCancelInput({ ...cancel, closeRequest: "yes" }), AppointmentInputError, "closeRequest must be true or false.");

  const close = { requestId: 20, expectedRequestUpdatedAt: "2026-11-05T10:00:00Z", reason: "NOT_VALTRIM_WORK" };
  assertEquals(parseCloseInput(close).reason, "NOT_VALTRIM_WORK");
  assertThrows(() => parseCloseInput({ ...close, reason: "CUSTOMER_ASKED" }), AppointmentInputError, "Choose why the request closes.");
  assertThrows(() => parseCloseInput({ ...close, reason: "DUPLICATE", duplicateOfRequestId: 20 }), AppointmentInputError,
    "A request is not a duplicate of itself.");
});
