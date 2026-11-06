// Travel minutes between two Customer Service visits from Google Routes API.
// The planner asks only for legs that have no stored estimate; a stored value
// (manual or earlier Routes result) always wins and is never recalculated.
// A failed or impossible route returns no minutes, never zero.

export const MAX_TRAVEL_LEGS = 8;
export const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

export interface TravelLeg {
  fromRequestId: number;
  toRequestId: number;
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
}

export type TravelStatus = "STORED" | "CALCULATED" | "MISSING_COORDINATES" | "NOT_FOUND" | "NO_ROUTE" | "FAILED";

export interface TravelResult extends TravelLeg {
  minutes: number | null;
  source: string | null;
  status: TravelStatus;
  message?: string;
}

export class TravelInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TravelInputError";
  }
}

const positiveId = (value: unknown) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export const legKey = (leg: TravelLeg) => `${leg.fromRequestId}>${leg.toRequestId}`;

export function parseTravelInput(body: unknown): TravelLeg[] {
  const legs = (body as { legs?: unknown } | null)?.legs;
  if (!Array.isArray(legs) || legs.length === 0) throw new TravelInputError("Send at least one travel leg.");
  if (legs.length > MAX_TRAVEL_LEGS) throw new TravelInputError(`Send at most ${MAX_TRAVEL_LEGS} travel legs at a time.`);
  const parsed = legs.map((leg) => {
    const fromRequestId = positiveId((leg as Record<string, unknown>)?.fromRequestId);
    const toRequestId = positiveId((leg as Record<string, unknown>)?.toRequestId);
    if (!fromRequestId || !toRequestId || fromRequestId === toRequestId) {
      throw new TravelInputError("Each travel leg needs two different request ids.");
    }
    return { fromRequestId, toRequestId };
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

export function routesRequestBody(origin: Coordinates, destination: Coordinates) {
  const waypoint = (point: Coordinates) => ({ location: { latLng: point } });
  // Traffic-unaware driving time: the stable, lowest-cost estimate. The
  // coordinator can still adjust it before registering.
  return { origin: waypoint(origin), destination: waypoint(destination), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" };
}

// Routes API returns durations like "754s". No route means no minutes.
export function minutesFromRoutesResponse(payload: unknown): number | null {
  const duration = (payload as { routes?: { duration?: unknown }[] } | null)?.routes?.[0]?.duration;
  const match = typeof duration === "string" ? /^(\d+(?:\.\d+)?)s$/u.exec(duration) : null;
  if (!match) return null;
  const minutes = Math.ceil(Number(match[1]) / 60);
  return minutes <= 999 ? minutes : null;
}

export async function fetchRouteMinutes(
  origin: Coordinates,
  destination: Coordinates,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<{ minutes: number } | { status: "NO_ROUTE" | "FAILED"; detail: string }> {
  try {
    const response = await fetcher(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration",
      },
      body: JSON.stringify(routesRequestBody(origin, destination)),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (payload as { error?: { status?: string; message?: string } } | null)?.error;
      return { status: "FAILED", detail: `HTTP ${response.status} ${message?.status ?? ""} ${message?.message ?? ""}`.trim() };
    }
    const minutes = minutesFromRoutesResponse(payload);
    return minutes === null ? { status: "NO_ROUTE", detail: "No driving route returned." } : { minutes };
  } catch (error) {
    return { status: "FAILED", detail: error instanceof Error ? error.message : String(error) };
  }
}

// Resolves each leg: stored estimate first, then Routes API when both visits
// have coordinates. Returns the results and the new rows to store.
export async function resolveTravelLegs({ legs, requests, stored, apiKey, fetcher, actorId }: {
  legs: TravelLeg[];
  requests: RequestLocationRow[];
  stored: StoredEstimateRow[];
  apiKey: string | undefined;
  fetcher?: typeof fetch;
  actorId: string;
}) {
  const byId = new Map(requests.map((row) => [Number(row.id), row]));
  const storedByKey = new Map(stored.map((row) => [
    legKey({ fromRequestId: Number(row.from_request_id), toRequestId: Number(row.to_request_id) }), row,
  ]));
  const label = (id: number) => byId.get(id)?.folio ?? `Request ${id}`;

  const results = await Promise.all(legs.map(async (leg): Promise<TravelResult> => {
    const existing = storedByKey.get(legKey(leg));
    if (existing) return { ...leg, minutes: existing.minutes, source: existing.source, status: "STORED" };
    if (!byId.has(leg.fromRequestId) || !byId.has(leg.toRequestId)) {
      return { ...leg, minutes: null, source: null, status: "NOT_FOUND", message: "A request in this leg was not found." };
    }
    const missing = [leg.fromRequestId, leg.toRequestId].filter((id) => !coordinatesOf(byId.get(id)));
    if (missing.length) {
      return {
        ...leg, minutes: null, source: null, status: "MISSING_COORDINATES",
        message: `${missing.map(label).join(" and ")} ${missing.length === 1 ? "has" : "have"} no coordinates. Enter the minutes manually.`,
      };
    }
    if (!apiKey) {
      return { ...leg, minutes: null, source: null, status: "FAILED", message: "Google Maps is not configured. Enter the minutes manually." };
    }
    const route = await fetchRouteMinutes(coordinatesOf(byId.get(leg.fromRequestId))!, coordinatesOf(byId.get(leg.toRequestId))!, apiKey, fetcher);
    if ("minutes" in route) return { ...leg, minutes: route.minutes, source: "ROUTES_API", status: "CALCULATED" };
    console.error("Routes API leg failed.", legKey(leg), route.detail);
    return {
      ...leg, minutes: null, source: null, status: route.status,
      message: route.status === "NO_ROUTE"
        ? `Google Maps found no driving route from ${label(leg.fromRequestId)} to ${label(leg.toRequestId)}. Enter the minutes manually.`
        : `Google Maps could not calculate ${label(leg.fromRequestId)} → ${label(leg.toRequestId)}. Enter the minutes manually.`,
    };
  }));

  const rowsToStore = results.filter((result) => result.status === "CALCULATED").map((result) => ({
    from_request_id: result.fromRequestId, to_request_id: result.toRequestId, minutes: result.minutes!,
    source: "ROUTES_API", created_by: actorId, updated_by: actorId,
  }));
  return { results, rowsToStore };
}
