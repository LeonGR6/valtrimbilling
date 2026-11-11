// Day-before traffic check (docs/customer-service-proposal-fit-plan.md, block R6; the
// warning is on screen only, decision D6 of 10 Nov 2026). Each afternoon the travel legs
// between consecutive visits of every technician on the next business day are asked
// again from Google with traffic, leaving at the end of the earlier visit plus its
// pickup. The planner and the calendar then show each visit's delay margin from those
// saved minutes. Pure helpers: no Deno, database or Google dependency.
import { californiaClockAt, parseServiceDate } from "./customerServiceScheduling.mjs";
import type { TravelLeg } from "./customerServiceTravel.ts";

// A second run for the same date within this many hours spends nothing. It bounds what
// a caller without credentials can cost, and still lets the afternoon run follow a
// morning one.
export const TRAVEL_CHECK_MIN_HOURS_BETWEEN_RUNS = 6;

// The next Monday–Friday after today's date in California.
export function nextBusinessDay(now: Date): string {
  const cursor = parseServiceDate(californiaClockAt(now).date) as Date;
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while ([0, 6].includes(cursor.getUTCDay()));
  return cursor.toISOString().slice(0, 10);
}

export interface TravelCheckAppointment {
  id: number;
  request_id: number;
  technician_ids: (number | string)[];
  starts_at: string;
  ends_at: string;
  pickup_minutes: number;
}

// One leg per consecutive pair of visits in each technician's day, leaving when the
// earlier visit ends plus its pickup. Technicians sharing a pair share the leg.
export function travelCheckLegs(appointments: TravelCheckAppointment[]): TravelLeg[] {
  const days = new Map<string, TravelCheckAppointment[]>();
  for (const appointment of appointments) {
    for (const technicianId of appointment.technician_ids) {
      const key = String(technicianId);
      days.set(key, [...(days.get(key) ?? []), appointment]);
    }
  }
  const legs = new Map<string, TravelLeg>();
  for (const day of days.values()) {
    const sorted = [...day].sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at));
    for (let index = 1; index < sorted.length; index += 1) {
      const before = sorted[index - 1];
      const after = sorted[index];
      const key = `${before.request_id}>${after.request_id}`;
      if (before.request_id === after.request_id || legs.has(key)) continue;
      const departureAt = new Date(Date.parse(before.ends_at) + Number(before.pickup_minutes) * 60_000).toISOString();
      legs.set(key, { fromRequestId: Number(before.request_id), toRequestId: Number(after.request_id), departureAt });
    }
  }
  return [...legs.values()];
}

export function recentlyChecked(lastCheckedAt: string | null | undefined, now: Date): boolean {
  if (!lastCheckedAt) return false;
  return now.getTime() - Date.parse(lastCheckedAt) < TRAVEL_CHECK_MIN_HOURS_BETWEEN_RUNS * 3600_000;
}
