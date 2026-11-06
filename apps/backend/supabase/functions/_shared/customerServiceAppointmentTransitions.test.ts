import { assertEquals } from "@std/assert";
import { type TransitionCandidate, dueAppointmentTransitions } from "./customerServiceAppointmentTransitions.ts";

// Monday 2026-11-09, 08:00–10:00 window in California (PST).
const row = (overrides: Partial<TransitionCandidate> = {}): TransitionCandidate => ({
  id: 7, request_id: 10, state: "SCHEDULED", is_current: true,
  window_starts_at: "2026-11-09T16:00:00Z", window_ends_at: "2026-11-09T18:00:00Z",
  service_requests: { workflow_stage: "CONFIRMED" }, ...overrides,
});
const at = (iso: string) => new Date(iso);

Deno.test("nothing is due before the window starts", () => {
  assertEquals(dueAppointmentTransitions([row()], at("2026-11-09T15:59:59Z")), []);
});

Deno.test("the request moves to WORKING when the window starts", () => {
  assertEquals(dueAppointmentTransitions([row()], at("2026-11-09T16:00:00Z")), [{ appointmentId: 7, to: "WORKING" }]);
  // Already WORKING: nothing more until the window ends.
  assertEquals(dueAppointmentTransitions([row({ service_requests: { workflow_stage: "WORKING" } })], at("2026-11-09T17:00:00Z")), []);
});

Deno.test("the appointment completes when the window ends, even if WORKING was missed", () => {
  for (const stage of ["CONFIRMED", "WORKING"]) {
    assertEquals(
      dueAppointmentTransitions([row({ service_requests: { workflow_stage: stage } })], at("2026-11-09T18:00:00Z")),
      [{ appointmentId: 7, to: "COMPLETED" }],
    );
  }
});

Deno.test("every appointment of the same window moves together", () => {
  const rows = [row(), row({ id: 8, request_id: 11 })];
  assertEquals(dueAppointmentTransitions(rows, at("2026-11-09T18:05:00Z")).map((item) => item.appointmentId), [7, 8]);
});

Deno.test("cancelled, replaced or already completed appointments are ignored", () => {
  const rows = [
    row({ state: "CANCELLED", is_current: false }),
    row({ id: 8, is_current: false }),
    row({ id: 9, state: "COMPLETED" }),
  ];
  assertEquals(dueAppointmentTransitions(rows, at("2026-11-09T19:00:00Z")), []);
});
