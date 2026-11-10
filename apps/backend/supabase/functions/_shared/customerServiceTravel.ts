// Travel minutes between two Customer Service visits from Google Routes API.
// A saved estimate is reused unless it is out of date. A manual value (MANUAL) is
// never recalculated. A traffic estimate is out of date when the traffic mode
// changed or the departure moved to another 30-minute slot. A failed or impossible
// route returns no minutes, never zero; if a saved value exists, it is kept.

export const MAX_TRAVEL_LEGS = 8;
export const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const ROUTES_FIELD_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters";
const METERS_PER_MILE = 1609.344;
const DEPARTURE_SLOT_MS = 30 * 60 * 1000;
const MAX_MILES = 9999.9;

// Road distance in miles with one decimal, or null when Google gave none.
export function milesFromMeters(meters: unknown): number | null {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) return null;
  const miles = Math.round((meters / METERS_PER_MILE) * 10) / 10;
  return miles <= MAX_MILES ? miles : null;
}

export const TRAFFIC_MODES = ["OFF", "BEST_GUESS", "PESSIMISTIC"] as const;
export type TrafficMode = (typeof TRAFFIC_MODES)[number];
export type TrafficModel = Exclude<TrafficMode, "OFF">;

export interface TravelLeg {
  fromRequestId: number;
  toRequestId: number;
  // Planned departure from the previous visit, as an ISO instant. Used only
  // when the traffic mode is not OFF.
  departureAt?: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RequestLocationRow {
  id: number;
  folio: string;
  service_properties: { latitude: number | string | null; longitude: number | string | null } | null;
}

export interface StoredEstimateRow {
  from_request_id: number;
  to_request_id: number;
  minutes: number;
  source: string;
  static_minutes?: number | null;
  distance_miles?: number | string | null;
  departure_at?: string | null;
  traffic_model?: string | null;
}

export type TravelStatus = "STORED" | "CALCULATED" | "MISSING_COORDINATES" | "NOT_FOUND" | "NO_ROUTE" | "FAILED";

export interface TravelResult extends TravelLeg {
  minutes: number | null;
  source: string | null;
  status: TravelStatus;
  message?: string;
  // Traffic details, so the planner can explain the minutes it shows.
  staticMinutes?: number | null;
  distanceMiles?: number | null;
  trafficModel?: TrafficModel | null;
  trafficDepartureAt?: string | null;
}

const storedDetails = (row: StoredEstimateRow) => ({
  staticMinutes: row.static_minutes ?? null,
  distanceMiles: row.distance_miles === null || row.distance_miles === undefined ? null : Number(row.distance_miles),
  trafficModel: (row.traffic_model ?? null) as TrafficModel | null,
  trafficDepartureAt: row.departure_at ?? null,
});

// Row written to service_travel_estimates for a new or refreshed Routes result.
export interface TravelRowToStore {
  from_request_id: number;
  to_request_id: number;
  minutes: number;
  source: "ROUTES_API";
  static_minutes: number;
  distance_miles: number | null;
  departure_at: string | null;
  traffic_model: TrafficModel | null;
  created_by: string;
  updated_by: string;
}

export interface TrafficRequest {
  model: TrafficModel;
  departureAt: string;
}

export interface RoutesRequestBody {
  origin: { location: { latLng: Coordinates } };
  destination: { location: { latLng: Coordinates } };
  travelMode: "DRIVE";
  routingPreference: "TRAFFIC_UNAWARE" | "TRAFFIC_AWARE_OPTIMAL";
  departureTime?: string;
  trafficModel?: TrafficModel;
}

export interface RouteDetails {
  minutes: number;
  staticMinutes: number;
  distanceMiles: number | null;
}

export class TravelInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TravelInputError";
  }
}

export const positiveId = (value: unknown) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export const legKey = (leg: TravelLeg) => `${leg.fromRequestId}>${leg.toRequestId}`;

export function parseTravelInput(body: unknown): TravelLeg[] {
  const legs = (body as { legs?: unknown } | null)?.legs;
  if (!Array.isArray(legs) || legs.length === 0) throw new TravelInputError("Send at least one travel leg.");
  if (legs.length > MAX_TRAVEL_LEGS) throw new TravelInputError(`Send at most ${MAX_TRAVEL_LEGS} travel legs at a time.`);
  const parsed = legs.map((leg): TravelLeg => {
    const fromRequestId = positiveId((leg as Record<string, unknown>)?.fromRequestId);
    const toRequestId = positiveId((leg as Record<string, unknown>)?.toRequestId);
    if (!fromRequestId || !toRequestId || fromRequestId === toRequestId) {
      throw new TravelInputError("Each travel leg needs two different request ids.");
    }
    const rawDeparture = (leg as Record<string, unknown>)?.departureAt;
    if (rawDeparture === undefined || rawDeparture === null || rawDeparture === "") {
      return { fromRequestId, toRequestId };
    }
    const instant = typeof rawDeparture === "string" ? Date.parse(rawDeparture) : Number.NaN;
    if (!Number.isFinite(instant)) throw new TravelInputError("departureAt must be a valid date and time.");
    return { fromRequestId, toRequestId, departureAt: new Date(instant).toISOString() };
  });
  if (new Set(parsed.map(legKey)).size !== parsed.length) throw new TravelInputError("Travel legs must be distinct.");
  return parsed;
}

export function coordinatesOf(row: RequestLocationRow | undefined): Coordinates | null {
  const latitude = Number(row?.service_properties?.latitude);
  const longitude = Number(row?.service_properties?.longitude);
  const present = row?.service_properties?.latitude != null && row?.service_properties?.longitude != null;
  return present && Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

export function routesRequestBody(
  origin: Coordinates,
  destination: Coordinates,
  traffic?: TrafficRequest,
): RoutesRequestBody {
  const waypoint = (point: Coordinates) => ({ location: { latLng: point } });
  const base = { origin: waypoint(origin), destination: waypoint(destination), travelMode: "DRIVE" as const };
  if (!traffic) {
    // Traffic-unaware driving time: the stable, lowest-cost estimate.
    return { ...base, routingPreference: "TRAFFIC_UNAWARE" };
  }
  // Traffic at the planned departure time, with Google's highest-quality model.
  return {
    ...base,
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    departureTime: traffic.departureAt,
    trafficModel: traffic.model,
  };
}

// Routes API returns durations like "754s". No value means no minutes.
export function minutesFromSeconds(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d+(?:\.\d+)?)s$/u.exec(value) : null;
  if (!match) return null;
  const minutes = Math.ceil(Number(match[1]) / 60);
  return minutes <= 999 ? minutes : null;
}

export function minutesFromRoutesResponse(payload: unknown): number | null {
  const route = (payload as { routes?: Record<string, unknown>[] } | null)?.routes?.[0];
  return minutesFromSeconds(route?.duration);
}

export function routeDetailsFromResponse(payload: unknown): RouteDetails | null {
  const route = (payload as { routes?: Record<string, unknown>[] } | null)?.routes?.[0];
  const minutes = minutesFromSeconds(route?.duration);
  if (minutes === null) return null;
  const staticMinutes = minutesFromSeconds(route?.staticDuration) ?? minutes;
  return { minutes, staticMinutes, distanceMiles: milesFromMeters(route?.distanceMeters) };
}

export async function fetchRoute(
  origin: Coordinates,
  destination: Coordinates,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  traffic?: TrafficRequest,
): Promise<{ route: RouteDetails } | { status: "NO_ROUTE" | "FAILED"; detail: string }> {
  try {
    const response = await fetcher(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK,
      },
      body: JSON.stringify(routesRequestBody(origin, destination, traffic)),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (payload as { error?: { status?: string; message?: string } } | null)?.error;
      return { status: "FAILED", detail: `HTTP ${response.status} ${message?.status ?? ""} ${message?.message ?? ""}`.trim() };
    }
    const route = routeDetailsFromResponse(payload);
    return route === null ? { status: "NO_ROUTE", detail: "No driving route returned." } : { route };
  } catch (error) {
    return { status: "FAILED", detail: error instanceof Error ? error.message : String(error) };
  }
}

interface TrafficTarget {
  model: TrafficModel | null;
  departureAt: string | null;
}

// Traffic needs a planned departure that is still in the future; otherwise the
// estimate ignores traffic.
export function trafficTargetFor(leg: TravelLeg, mode: TrafficMode, now: Date): TrafficTarget {
  if (mode === "OFF" || !leg.departureAt || Date.parse(leg.departureAt) <= now.getTime()) {
    return { model: null, departureAt: null };
  }
  return { model: mode, departureAt: leg.departureAt };
}

const departureSlot = (value: string | null | undefined) =>
  value ? Math.floor(Date.parse(value) / DEPARTURE_SLOT_MS) : null;

export function isStaleEstimate(row: StoredEstimateRow, target: TrafficTarget): boolean {
  if (row.source === "MANUAL") return false;
  if ((row.traffic_model ?? null) !== target.model) return true;
  if (target.model === null) return false;
  return departureSlot(row.departure_at) !== departureSlot(target.departureAt);
}

interface LegOutcome {
  result: TravelResult;
  row?: TravelRowToStore;
  replaces?: boolean;
}

// Resolves each leg: a current saved estimate first, then Routes API when both
// visits have coordinates. Returns the results, the new rows to insert and the
// out-of-date rows to replace (never manual ones).
export async function resolveTravelLegs({
  legs,
  requests,
  stored,
  apiKey,
  fetcher,
  actorId,
  trafficMode = "OFF",
  now = new Date(),
}: {
  legs: TravelLeg[];
  requests: RequestLocationRow[];
  stored: StoredEstimateRow[];
  apiKey: string | undefined;
  fetcher?: typeof fetch;
  actorId: string;
  trafficMode?: TrafficMode;
  now?: Date;
}) {
  const byId = new Map(requests.map((row) => [Number(row.id), row]));
  const storedByKey = new Map(stored.map((row) => [
    legKey({ fromRequestId: Number(row.from_request_id), toRequestId: Number(row.to_request_id) }), row,
  ]));
  const label = (id: number) => byId.get(id)?.folio ?? `Request ${id}`;

  const outcomes = await Promise.all(legs.map(async (leg): Promise<LegOutcome> => {
    const existing = storedByKey.get(legKey(leg));
    const target = trafficTargetFor(leg, trafficMode, now);
    if (existing && !isStaleEstimate(existing, target)) {
      return { result: { ...leg, minutes: existing.minutes, source: existing.source, status: "STORED", ...storedDetails(existing) } };
    }
    // A saved value is kept when a refresh is impossible; it is still usable.
    const failed = (result: TravelResult): LegOutcome => existing
      ? {
        result: {
          ...leg, minutes: existing.minutes, source: existing.source, status: "STORED",
          ...storedDetails(existing),
          message: "Google Maps could not refresh the traffic estimate. The saved value is kept.",
        },
      }
      : { result };

    if (!byId.has(leg.fromRequestId) || !byId.has(leg.toRequestId)) {
      return failed({ ...leg, minutes: null, source: null, status: "NOT_FOUND", message: "A request in this leg was not found." });
    }
    const missing = [leg.fromRequestId, leg.toRequestId].filter((id) => !coordinatesOf(byId.get(id)));
    if (missing.length) {
      return failed({
        ...leg, minutes: null, source: null, status: "MISSING_COORDINATES",
        message: `${missing.map(label).join(" and ")} ${missing.length === 1 ? "has" : "have"} no coordinates. Enter the minutes manually.`,
      });
    }
    if (!apiKey) {
      return failed({ ...leg, minutes: null, source: null, status: "FAILED", message: "Google Maps is not configured. Enter the minutes manually." });
    }

    const traffic = target.model && target.departureAt
      ? { model: target.model, departureAt: target.departureAt }
      : undefined;
    const route = await fetchRoute(
      coordinatesOf(byId.get(leg.fromRequestId))!,
      coordinatesOf(byId.get(leg.toRequestId))!,
      apiKey,
      fetcher,
      traffic,
    );
    if ("route" in route) {
      const { minutes, staticMinutes, distanceMiles } = route.route;
      return {
        result: {
          ...leg, minutes, source: "ROUTES_API", status: "CALCULATED",
          staticMinutes, distanceMiles, trafficModel: target.model, trafficDepartureAt: target.departureAt,
        },
        row: {
          from_request_id: leg.fromRequestId,
          to_request_id: leg.toRequestId,
          minutes,
          source: "ROUTES_API",
          static_minutes: staticMinutes,
          distance_miles: distanceMiles,
          departure_at: target.departureAt,
          traffic_model: target.model,
          created_by: actorId,
          updated_by: actorId,
        },
        replaces: existing !== undefined,
      };
    }
    console.error("Routes API leg failed.", legKey(leg), route.detail);
    return failed({
      ...leg, minutes: null, source: null, status: route.status,
      message: route.status === "NO_ROUTE"
        ? `Google Maps found no driving route from ${label(leg.fromRequestId)} to ${label(leg.toRequestId)}. Enter the minutes manually.`
        : `Google Maps could not calculate ${label(leg.fromRequestId)} → ${label(leg.toRequestId)}. Enter the minutes manually.`,
    });
  }));

  const rowsToStore: TravelRowToStore[] = [];
  const rowsToReplace: TravelRowToStore[] = [];
  for (const outcome of outcomes) {
    if (!outcome.row) continue;
    (outcome.replaces ? rowsToReplace : rowsToStore).push(outcome.row);
  }
  return { results: outcomes.map((outcome) => outcome.result), rowsToStore, rowsToReplace };
}
