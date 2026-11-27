import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { RequestLocationRow, StoredEstimateRow } from "./customerServiceTravel.ts";
import { TravelInputError } from "./customerServiceTravel.ts";
import {
  MAX_NEARBY_CANDIDATES,
  matrixRoutesFromResponse,
  parseNearbyInput,
  resolveNearbyDriving,
  ROUTE_MATRIX_ENDPOINT,
  ROUTE_MATRIX_FIELD_MASK,
  routeMatrixRequestBody,
} from "./customerServiceTravelMatrix.ts";

const place = (id: number, latitude: number | string | null, longitude: number | string | null): RequestLocationRow => ({
  id, folio: `CS-${id}`, service_properties: { latitude, longitude },
});

// Echo Highlands (planned), the same Job, Harmony (8.3 mi straight), Linwood (32.6 mi).
const requests = [
  place(1022, "33.660230000000000", "-117.388310000000000"),
  place(1496, "33.660230000000000", "-117.388310000000000"),
  place(1497, "33.655301100000000", "-117.243801500000000"),
  place(1023, "33.944690000000000", "-116.934520000000000"),
  place(1030, null, null),
];
const bands = { distanceGreenMaxMiles: 5, distanceYellowMaxMiles: 10, distanceOrangeMaxMiles: 20 };
const MILE = 1609.344;

function fakeMatrix(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift() ?? new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const matrixResponse = (elements: unknown[]) => new Response(JSON.stringify(elements), { status: 200 });
const sentBody = (call: { init: RequestInit }) => JSON.parse(String(call.init.body));

Deno.test("nearby input is optional and must name distinct candidates other than the request", () => {
  assertEquals(parseNearbyInput({ legs: [] }), null);
  assertEquals(parseNearbyInput({ nearby: { requestId: 1022, candidateIds: [1497, "1023"] } }), {
    requestId: 1022, candidateIds: [1497, 1023],
  });
  assertThrows(() => parseNearbyInput({ nearby: { candidateIds: [1497] } }), TravelInputError);
  assertThrows(() => parseNearbyInput({ nearby: { requestId: 1022, candidateIds: [] } }), TravelInputError);
  assertThrows(() => parseNearbyInput({ nearby: { requestId: 1022, candidateIds: [1022] } }), TravelInputError);
  assertThrows(() => parseNearbyInput({ nearby: { requestId: 1022, candidateIds: [1497, 1497] } }), TravelInputError);
  const tooMany = Array.from({ length: MAX_NEARBY_CANDIDATES + 1 }, (_, index) => 2000 + index);
  assertThrows(() => parseNearbyInput({ nearby: { requestId: 1022, candidateIds: tooMany } }), TravelInputError);
});

Deno.test("the matrix asks for traffic-unaware driving (Essentials)", () => {
  const body = routeMatrixRequestBody([{ latitude: 1, longitude: 2 }], [{ latitude: 3, longitude: 4 }]);
  assertEquals(body, {
    origins: [{ waypoint: { location: { latLng: { latitude: 1, longitude: 2 } } } }],
    destinations: [{ waypoint: { location: { latLng: { latitude: 3, longitude: 4 } } } }],
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
  });
  assert(ROUTE_MATRIX_FIELD_MASK.split(",").includes("status"));
});

Deno.test("matrix elements: zero values omitted by JSON, missing routes and element errors", () => {
  const routes = matrixRoutesFromResponse([
    { status: {}, condition: "ROUTE_EXISTS", duration: "754s", distanceMeters: 11.5 * MILE },
    { destinationIndex: 1, status: {}, condition: "ROUTE_EXISTS", duration: "0s" },
    { destinationIndex: 2, status: {}, condition: "ROUTE_NOT_FOUND" },
    { destinationIndex: 3, status: { code: 3, message: "Invalid waypoint" } },
  ]);
  assertEquals(routes.get("0>0"), { minutes: 13, distanceMiles: 11.5 });
  assertEquals(routes.get("0>1"), { minutes: 0, distanceMiles: 0 });
  assertEquals(routes.get("0>2"), null);
  assertEquals(routes.get("0>3"), null);
  assertEquals(matrixRoutesFromResponse({ error: {} }).size, 0);
});

Deno.test("same Job is green at zero miles and beyond the last band is red, both without Google", async () => {
  const { fetcher, calls } = fakeMatrix([]);
  const { results, rowsToStore } = await resolveNearbyDriving({
    input: { requestId: 1022, candidateIds: [1496, 1023, 1030, 9999] },
    requests, stored: [], bands, apiKey: "key", fetcher, actorId: "actor",
  });
  assertEquals(calls.length, 0);
  assertEquals(rowsToStore, []);
  assertEquals(results.map(({ requestId, drivingMiles, band, status }) => ({ requestId, drivingMiles, band, status })), [
    { requestId: 1496, drivingMiles: 0, band: "GREEN", status: "SAME_LOCATION" },
    { requestId: 1023, drivingMiles: null, band: "RED", status: "BEYOND_RANGE" },
    { requestId: 1030, drivingMiles: null, band: null, status: "MISSING_COORDINATES" },
    { requestId: 9999, drivingMiles: null, band: null, status: "NOT_FOUND" },
  ]);
  assert(results[1].straightMiles! > 32 && results[1].straightMiles! < 33);
  assertEquals(results.map(({ drivingMinutes }) => drivingMinutes), [0, null, null, null]);
});

Deno.test("a nearby candidate gets driving miles both ways, colored by the longer one, and is cached", async () => {
  const { fetcher, calls } = fakeMatrix([
    matrixResponse([{ status: {}, condition: "ROUTE_EXISTS", duration: "1380s", distanceMeters: 11.5 * MILE }]),
    matrixResponse([{ status: {}, condition: "ROUTE_EXISTS", duration: "1320s", distanceMeters: 9.8 * MILE }]),
  ]);
  const { results, rowsToStore, distanceUpdates } = await resolveNearbyDriving({
    input: { requestId: 1022, candidateIds: [1497] },
    requests, stored: [], bands, apiKey: "key", fetcher, actorId: "actor",
  });
  assertEquals(calls.length, 2);
  assertEquals(calls[0].url, ROUTE_MATRIX_ENDPOINT);
  assertEquals((calls[0].init.headers as Record<string, string>)["X-Goog-FieldMask"], ROUTE_MATRIX_FIELD_MASK);
  assertEquals(sentBody(calls[0]).origins.length, 1);
  assertEquals(sentBody(calls[0]).destinations.length, 1);
  assertEquals(sentBody(calls[1]).origins[0].waypoint.location.latLng, { latitude: 33.6553011, longitude: -117.2438015 });
  assertEquals(results[0].drivingMiles, 11.5);
  // The minutes without traffic of the longer direction: 23 out, 22 back.
  assertEquals(results[0].drivingMinutes, 23);
  assertEquals(results[0].band, "ORANGE");
  assertEquals(results[0].status, "CALCULATED");
  assertEquals(distanceUpdates, []);
  assertEquals(rowsToStore, [
    {
      from_request_id: 1022, to_request_id: 1497, minutes: 23, source: "ROUTES_API", static_minutes: 23,
      distance_miles: 11.5, departure_at: null, traffic_model: null, created_by: "actor", updated_by: "actor",
    },
    {
      from_request_id: 1497, to_request_id: 1022, minutes: 22, source: "ROUTES_API", static_minutes: 22,
      distance_miles: 9.8, departure_at: null, traffic_model: null, created_by: "actor", updated_by: "actor",
    },
  ]);
});

Deno.test("saved distances are reused and a saved row without distance only gets the distance", async () => {
  const stored: StoredEstimateRow[] = [
    // Saved with traffic by the planner: its distance is reused.
    {
      from_request_id: 1022, to_request_id: 1497, minutes: 23, source: "ROUTES_API", static_minutes: 23,
      distance_miles: "11.5", departure_at: "2026-11-12T17:25:00Z", traffic_model: "BEST_GUESS",
    },
    // Saved before distances existed: Google is asked, the minutes stay.
    { from_request_id: 1497, to_request_id: 1022, minutes: 25, source: "MANUAL", distance_miles: null },
  ];
  const { fetcher, calls } = fakeMatrix([
    matrixResponse([{ status: {}, condition: "ROUTE_EXISTS", duration: "1320s", distanceMeters: 9.8 * MILE }]),
  ]);
  const { results, rowsToStore, distanceUpdates } = await resolveNearbyDriving({
    input: { requestId: 1022, candidateIds: [1497] },
    requests, stored, bands, apiKey: "key", fetcher, actorId: "actor",
  });
  assertEquals(calls.length, 1);
  assertEquals(sentBody(calls[0]).destinations.length, 1);
  assertEquals(rowsToStore, []);
  assertEquals(distanceUpdates, [{ from_request_id: 1497, to_request_id: 1022, distance_miles: 9.8, updated_by: "actor" }]);
  assertEquals(results[0].drivingMiles, 11.5);
  // Saved minutes without traffic out (23); the back leg uses Google's 22, not the manual 25.
  assertEquals(results[0].drivingMinutes, 23);

  // Both directions saved: nothing goes to Google.
  const both = fakeMatrix([]);
  const cached = await resolveNearbyDriving({
    input: { requestId: 1022, candidateIds: [1497] },
    requests, stored: [stored[0], { ...stored[1], distance_miles: 9.8 }], bands, apiKey: "key",
    fetcher: both.fetcher, actorId: "actor",
  });
  assertEquals(both.calls.length, 0);
  assertEquals(cached.results[0].status, "STORED");
  // A manual leg with its distance counts as typed: the longer of 23 and 25.
  assertEquals(cached.results[0].drivingMinutes, 25);
});

Deno.test("a Google failure leaves the driving miles empty and stores nothing", async () => {
  const { fetcher } = fakeMatrix([
    new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "API not enabled" } }), { status: 403 }),
    new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "API not enabled" } }), { status: 403 }),
  ]);
  const failed = await resolveNearbyDriving({
    input: { requestId: 1022, candidateIds: [1497] },
    requests, stored: [], bands, apiKey: "key", fetcher, actorId: "actor",
  });
  assertEquals(failed.results[0].drivingMiles, null);
  assertEquals(failed.results[0].band, null);
  assertEquals(failed.results[0].status, "FAILED");
  assertEquals(failed.rowsToStore, []);

  const noKey = await resolveNearbyDriving({
    input: { requestId: 1022, candidateIds: [1497] },
    requests, stored: [], bands, apiKey: undefined, actorId: "actor",
  });
  assertEquals(noKey.results[0].status, "FAILED");

  const noRoute = fakeMatrix([
    matrixResponse([{ status: {}, condition: "ROUTE_NOT_FOUND" }]),
    matrixResponse([{ status: {}, condition: "ROUTE_NOT_FOUND" }]),
  ]);
  const unreachable = await resolveNearbyDriving({
    input: { requestId: 1022, candidateIds: [1497] },
    requests, stored: [], bands, apiKey: "key", fetcher: noRoute.fetcher, actorId: "actor",
  });
  assertEquals(unreachable.results[0].status, "NO_ROUTE");
});

Deno.test("the planned request needs coordinates", async () => {
  await assertRejects(
    () =>
      resolveNearbyDriving({
        input: { requestId: 1030, candidateIds: [1497] },
        requests, stored: [], bands, apiKey: "key", actorId: "actor",
      }),
    TravelInputError,
  );
});
