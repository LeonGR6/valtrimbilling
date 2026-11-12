// Day-before traffic check (docs/customer-service-proposal-fit-plan.md, block R6; the
// warning is on screen only, decision D6 of 10 Nov 2026). Each afternoon the travel legs
// between consecutive visits of every technician on the next business day are asked
// again from Google with traffic, leaving at the end of the earlier visit plus its
// pickup. The planner and the calendar then show each visit's delay margin from those
// saved minutes. Pure helpers: no Deno, database or Google dependency.
import { californiaClockAt, parseServiceDate } from "./customerServiceScheduling.mjs";
import {
  coordinatesOf,
  fetchRoute,
  legKey,
  type RequestLocationRow,
  type StoredEstimateRow,
  type TrafficMode,
  trafficTargetFor,
  type TravelLeg,
} from "./customerServiceTravel.ts";

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

export interface ManualLegCheck {
  from_request_id: number;
  to_request_id: number;
  google_minutes: number;
}

// Decision P5 (12 Nov 2026): a manual leg is never recalculated, but the check also asks
// Google for it at the same departure and traffic, so the screens can warn when the
// typed minutes are lower. Only Google's minutes are returned; the leg keeps its value.
// A leg without coordinates, or one Google cannot answer, is skipped.
export async function manualLegChecks({
  legs,
  stored,
  requests,
  apiKey,
  fetcher,
  trafficMode,
  now = new Date(),
}: {
  legs: TravelLeg[];
  stored: StoredEstimateRow[];
  requests: RequestLocationRow[];
  apiKey: string | undefined;
  fetcher?: typeof fetch;
  trafficMode: TrafficMode;
  now?: Date;
}): Promise<ManualLegCheck[]> {
  if (!apiKey) return [];
  const manualKeys = new Set(stored.filter((row) => row.source === "MANUAL")
    .map((row) => legKey({ fromRequestId: Number(row.from_request_id), toRequestId: Number(row.to_request_id) })));
  const byId = new Map(requests.map((row) => [Number(row.id), row]));
  const checks = await Promise.all(legs.filter((leg) => manualKeys.has(legKey(leg))).map(async (leg) => {
    const origin = coordinatesOf(byId.get(leg.fromRequestId));
    const destination = coordinatesOf(byId.get(leg.toRequestId));
    if (!origin || !destination) return null;
    const target = trafficTargetFor(leg, trafficMode, now);
    const traffic = target.model && target.departureAt ? { model: target.model, departureAt: target.departureAt } : undefined;
    const route = await fetchRoute(origin, destination, apiKey, fetcher, traffic);
    if (!("route" in route)) {
      console.error("Manual leg check failed.", legKey(leg), route.detail);
      return null;
    }
    return { from_request_id: leg.fromRequestId, to_request_id: leg.toRequestId, google_minutes: route.route.minutes };
  }));
  return checks.filter((check): check is ManualLegCheck => check !== null);
}

export function recentlyChecked(lastCheckedAt: string | null | undefined, now: Date): boolean {
  if (!lastCheckedAt) return false;
  return now.getTime() - Date.parse(lastCheckedAt) < TRAVEL_CHECK_MIN_HOURS_BETWEEN_RUNS * 3600_000;
}
