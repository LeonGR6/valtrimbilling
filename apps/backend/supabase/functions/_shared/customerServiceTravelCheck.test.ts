import { assertEquals } from "@std/assert";
import { nextBusinessDay, recentlyChecked, travelCheckLegs } from "./customerServiceTravelCheck.ts";

Deno.test("the check looks at the next business day in California", () => {
  // Wednesday 11 Nov 2026 at 4:00 PM in California (midnight UTC): Thursday 12.
  assertEquals(nextBusinessDay(new Date("2026-11-12T00:00:00Z")), "2026-11-12");
  // Friday 13 Nov at 4:00 PM: Monday 16.
  assertEquals(nextBusinessDay(new Date("2026-11-14T00:00:00Z")), "2026-11-16");
  // Saturday morning: Monday too.
  assertEquals(nextBusinessDay(new Date("2026-11-14T17:00:00Z")), "2026-11-16");
});

Deno.test("legs between consecutive visits leave after the earlier visit and its pickup", () => {
  // Thursday 12 Nov, Jorge (82): CS-2496 8:00–8:30, CS-2022 8:45–9:15, CS-2497 10:00–10:45.
  // Hilario (90) shares CS-2022 and CS-2497, so that pair is asked once.
  const legs = travelCheckLegs([
    { id: 3, request_id: 1497, technician_ids: [82, 90], starts_at: "2026-11-12T18:00:00Z", ends_at: "2026-11-12T18:45:00Z", pickup_minutes: 10 },
    { id: 1, request_id: 1496, technician_ids: [82], starts_at: "2026-11-12T16:00:00Z", ends_at: "2026-11-12T16:30:00Z", pickup_minutes: 10 },
    { id: 2, request_id: 1022, technician_ids: ["82", "90"], starts_at: "2026-11-12T16:45:00Z", ends_at: "2026-11-12T17:15:00Z", pickup_minutes: 10 },
  ]);
  assertEquals(legs, [
    { fromRequestId: 1496, toRequestId: 1022, departureAt: "2026-11-12T16:40:00.000Z" },
    { fromRequestId: 1022, toRequestId: 1497, departureAt: "2026-11-12T17:25:00.000Z" },
  ]);
  // A single visit has no leg.
  assertEquals(travelCheckLegs([
    { id: 1, request_id: 1496, technician_ids: [82], starts_at: "2026-11-12T16:00:00Z", ends_at: "2026-11-12T16:30:00Z", pickup_minutes: 10 },
  ]), []);
});

Deno.test("a run within six hours of the last one for that date spends nothing", () => {
  const now = new Date("2026-11-12T00:00:00Z");
  assertEquals(recentlyChecked(null, now), false);
  assertEquals(recentlyChecked("2026-11-11T19:00:00Z", now), true);
  assertEquals(recentlyChecked("2026-11-11T17:00:00Z", now), false);
});
