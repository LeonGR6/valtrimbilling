// Driving miles between the request being planned and its nearby candidates, used
// for the nearby-visit colors (decision 7 of the nearby-visits plan).
//
// - One Google Route Matrix call per direction (request → candidates and
//   candidates → request), traffic-unaware: billed per element as Compute Route
//   Matrix Essentials. The minutes with traffic stay with computeRoutes.
// - Only candidates within the last distance band in a straight line go to Google.
//   Driving is never shorter than the straight line, so the rest are red as they are.
// - Saved distances are reused. New results are cached in service_travel_estimates
//   without traffic and never over an existing row; an existing row without a
//   distance only gets its distance filled in.
// - A failure leaves the driving miles empty, never zero: the planner then shows the
//   straight-line miles without a color.
import { calculateDistanceMiles, maxNearbyDrivingCandidates, proximityBand } from "./customerServiceProximity.mjs";
import {
  type Coordinates,
  coordinatesOf,
  milesFromMeters,
  minutesFromSeconds,
  positiveId,
  type RequestLocationRow,
  type StoredEstimateRow,
  TravelInputError,
} from "./customerServiceTravel.ts";

export const MAX_NEARBY_CANDIDATES: number = maxNearbyDrivingCandidates;
export const ROUTE_MATRIX_ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
// status is required: without it Google reports every element as OK.
export const ROUTE_MATRIX_FIELD_MASK = "originIndex,destinationIndex,status,condition,distanceMeters,duration";

export interface DistanceBands {
  distanceGreenMaxMiles: number;
  distanceYellowMaxMiles: number;
  distanceOrangeMaxMiles: number;
}

export interface NearbyInput {
  requestId: number;
  candidateIds: number[];
}

export type NearbyStatus =
  | "STORED"
  | "CALCULATED"
  | "SAME_LOCATION"
  | "BEYOND_RANGE"
  | "MISSING_COORDINATES"
  | "NOT_FOUND"
  | "NO_ROUTE"
  | "FAILED";

export interface NearbyResult {
  requestId: number;
  straightMiles: number | null;
  drivingMiles: number | null;
  band: string | null;
  status: NearbyStatus;
}

export interface MatrixRowToStore {
  from_request_id: number;
  to_request_id: number;
  minutes: number;
  source: "ROUTES_API";
  static_minutes: number;
  distance_miles: number;
  departure_at: null;
  traffic_model: null;
  created_by: string;
  updated_by: string;
}

export interface DistanceUpdate {
  from_request_id: number;
  to_request_id: number;
  distance_miles: number;
  updated_by: string;
}

interface MatrixRoute {
  minutes: number;
  distanceMiles: number;
}

// Body { nearby: { requestId, candidateIds } }; null when the body asks for travel legs.
export function parseNearbyInput(body: unknown): NearbyInput | null {
  const nearby = (body as { nearby?: unknown } | null)?.nearby as Record<string, unknown> | undefined;
  if (nearby === undefined) return null;
  const requestId = positiveId(nearby?.requestId);
  if (!requestId) throw new TravelInputError("Send the request to compare with its nearby visits.");
  const raw = nearby?.candidateIds;
  if (!Array.isArray(raw) || raw.length === 0) throw new TravelInputError("Send at least one nearby candidate.");
  if (raw.length > MAX_NEARBY_CANDIDATES) {
    throw new TravelInputError(`Send at most ${MAX_NEARBY_CANDIDATES} nearby candidates at a time.`);
  }
  const candidateIds = raw.map(positiveId);
  if (candidateIds.some((id) => !id || id === requestId)) {
    throw new TravelInputError("Each nearby candidate needs a request id different from the planned request.");
  }
  if (new Set(candidateIds).size !== candidateIds.length) throw new TravelInputError("Nearby candidates must be distinct.");
  return { requestId, candidateIds: candidateIds as number[] };
}

export function routeMatrixRequestBody(origins: Coordinates[], destinations: Coordinates[]) {
  const waypoint = (point: Coordinates) => ({ waypoint: { location: { latLng: point } } });
  return {
    origins: origins.map(waypoint),
    destinations: destinations.map(waypoint),
    travelMode: "DRIVE" as const,
    // Traffic-unaware keeps the matrix in the Essentials tier.
    routingPreference: "TRAFFIC_UNAWARE" as const,
  };
}

// Routes by "originIndex>destinationIndex". JSON omits zero values, so a missing
// index is 0 and a missing distance on an existing route is 0 miles.
export function matrixRoutesFromResponse(payload: unknown): Map<string, MatrixRoute | null> {
  const routes = new Map<string, MatrixRoute | null>();
  if (!Array.isArray(payload)) return routes;
  for (const element of payload as Record<string, unknown>[]) {
    const key = `${Number(element?.originIndex ?? 0)}>${Number(element?.destinationIndex ?? 0)}`;
    const code = (element?.status as { code?: number } | undefined)?.code ?? 0;
    const minutes = minutesFromSeconds(element?.duration);
    const distanceMiles = milesFromMeters(element?.distanceMeters ?? 0);
    routes.set(
      key,
      code === 0 && element?.condition === "ROUTE_EXISTS" && minutes !== null && distanceMiles !== null
        ? { minutes, distanceMiles }
        : null,
    );
  }
  return routes;
}

export async function fetchRouteMatrix(
  origins: Coordinates[],
  destinations: Coordinates[],
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<{ routes: Map<string, MatrixRoute | null> } | { failed: string }> {
  try {
    const response = await fetcher(ROUTE_MATRIX_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ROUTE_MATRIX_FIELD_MASK,
      },
      body: JSON.stringify(routeMatrixRequestBody(origins, destinations)),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (payload as { error?: { status?: string; message?: string } } | null)?.error;
      return { failed: `HTTP ${response.status} ${error?.status ?? ""} ${error?.message ?? ""}`.trim() };
    }
    return { routes: matrixRoutesFromResponse(payload) };
  } catch (error) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }
}

const pairKey = (fromRequestId: number, toRequestId: number) => `${fromRequestId}>${toRequestId}`;

export async function resolveNearbyDriving({
  input,
  requests,
  stored,
  bands,
  apiKey,
  fetcher,
  actorId,
}: {
  input: NearbyInput;
  requests: RequestLocationRow[];
  stored: StoredEstimateRow[];
  bands: DistanceBands;
  apiKey: string | undefined;
  fetcher?: typeof fetch;
  actorId: string;
}) {
  const byId = new Map(requests.map((row) => [Number(row.id), row]));
  const origin = coordinatesOf(byId.get(input.requestId));
  if (!origin) throw new TravelInputError("The planned request has no coordinates.");
  const storedByKey = new Map(stored.map((row) => [pairKey(Number(row.from_request_id), Number(row.to_request_id)), row]));
  const savedMiles = (from: number, to: number) => {
    const value = storedByKey.get(pairKey(from, to))?.distance_miles;
    return value === null || value === undefined ? null : Number(value);
  };

  // Straight line first: it decides who goes to Google.
  const candidates = input.candidateIds.map((id) => {
    const row = byId.get(id);
    const point = coordinatesOf(row);
    const straightMiles = point ? calculateDistanceMiles(origin, point) : null;
    return {
      id, row, point, straightMiles,
      out: savedMiles(input.requestId, id), back: savedMiles(id, input.requestId),
      fromGoogle: false,
    };
  });
  const inRange = (candidate: typeof candidates[number]) =>
    candidate.point !== null && candidate.straightMiles !== null && candidate.straightMiles > 0 &&
    candidate.straightMiles <= bands.distanceOrangeMaxMiles;
  const needOut = candidates.filter((candidate) => inRange(candidate) && candidate.out === null);
  const needBack = candidates.filter((candidate) => inRange(candidate) && candidate.back === null);

  const rowsToStore: MatrixRowToStore[] = [];
  const distanceUpdates: DistanceUpdate[] = [];
  let googleFailed = false;
  const remember = (from: number, to: number, route: MatrixRoute) => {
    if (storedByKey.has(pairKey(from, to))) {
      distanceUpdates.push({ from_request_id: from, to_request_id: to, distance_miles: route.distanceMiles, updated_by: actorId });
    } else {
      rowsToStore.push({
        from_request_id: from, to_request_id: to, minutes: route.minutes, source: "ROUTES_API",
        static_minutes: route.minutes, distance_miles: route.distanceMiles, departure_at: null, traffic_model: null,
        created_by: actorId, updated_by: actorId,
      });
    }
  };

  if ((needOut.length || needBack.length) && !apiKey) googleFailed = true;
  if ((needOut.length || needBack.length) && apiKey) {
    const [outbound, inbound] = await Promise.all([
      needOut.length ? fetchRouteMatrix([origin], needOut.map((candidate) => candidate.point!), apiKey, fetcher) : null,
      needBack.length ? fetchRouteMatrix(needBack.map((candidate) => candidate.point!), [origin], apiKey, fetcher) : null,
    ]);
    for (const [result, label] of [[outbound, "request → candidates"], [inbound, "candidates → request"]] as const) {
      if (result && "failed" in result) {
        googleFailed = true;
        console.error(`Route Matrix ${label} failed.`, result.failed);
      }
    }
    if (outbound && "routes" in outbound) {
      needOut.forEach((candidate, index) => {
        const route = outbound.routes.get(`0>${index}`);
        if (!route) return;
        candidate.out = route.distanceMiles;
        candidate.fromGoogle = true;
        remember(input.requestId, candidate.id, route);
      });
    }
    if (inbound && "routes" in inbound) {
      needBack.forEach((candidate, index) => {
        const route = inbound.routes.get(`${index}>0`);
        if (!route) return;
        candidate.back = route.distanceMiles;
        candidate.fromGoogle = true;
        remember(candidate.id, input.requestId, route);
      });
    }
  }

  const results: NearbyResult[] = candidates.map((candidate) => {
    const base = { requestId: candidate.id, straightMiles: candidate.straightMiles };
    if (!candidate.row) return { ...base, drivingMiles: null, band: null, status: "NOT_FOUND" };
    if (!candidate.point) return { ...base, drivingMiles: null, band: null, status: "MISSING_COORDINATES" };
    if (candidate.straightMiles === 0) {
      return { ...base, drivingMiles: 0, band: proximityBand(0, bands), status: "SAME_LOCATION" };
    }
    if (!inRange(candidate)) return { ...base, drivingMiles: null, band: "RED", status: "BEYOND_RANGE" };
    // The color uses the longer direction, so a one-way shortcut never looks nearer.
    const known = [candidate.out, candidate.back].filter((miles): miles is number => miles !== null);
    if (!known.length) {
      return { ...base, drivingMiles: null, band: null, status: googleFailed ? "FAILED" : "NO_ROUTE" };
    }
    const drivingMiles = Math.max(...known);
    return {
      ...base, drivingMiles, band: proximityBand(drivingMiles, bands),
      status: candidate.fromGoogle ? "CALCULATED" : "STORED",
    };
  });
  return { results, rowsToStore, distanceUpdates };
}
