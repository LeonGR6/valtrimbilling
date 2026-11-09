import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  minutesFromRoutesResponse,
  parseTravelInput,
  type RequestLocationRow,
  resolveTravelLegs,
  ROUTES_ENDPOINT,
  ROUTES_FIELD_MASK,
  routeDetailsFromResponse,
  routesRequestBody,
  TravelInputError,
} from "./customerServiceTravel.ts";

const requests: RequestLocationRow[] = [
  { id: 10, folio: "CS-0010", service_properties: { latitude: "33.977882057707450", longitude: "-117.345207659413190" } },
  { id: 20, folio: "CS-0020", service_properties: { latitude: 33.986588, longitude: -117.343021 } },
  { id: 30, folio: "CS-0030", service_properties: { latitude: null, longitude: null } },
];

// Planning moment: 8:00 in California. The 8:40 departure is in the 8:30 slot,
// the 8:50 departure shares that slot, and 12:40 is a different slot.
const NOW = new Date("2026-11-09T16:00:00Z");
const DEPARTURE = "2026-11-09T16:40:00.000Z";
const SAME_SLOT = "2026-11-09T16:50:00.000Z";
const OTHER_SLOT = "2026-11-09T20:40:00.000Z";

function fakeRoutes(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift() ?? new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function sentBody(call: { init: RequestInit }) {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

Deno.test("input parsing requires distinct legs between two different requests", () => {
  assertEquals(parseTravelInput({ legs: [{ fromRequestId: "10", toRequestId: 20 }] }), [{ fromRequestId: 10, toRequestId: 20 }]);
  for (const bad of [
    null, {}, { legs: [] },
    { legs: [{ fromRequestId: 10, toRequestId: 10 }] },
    { legs: [{ fromRequestId: 10, toRequestId: -2 }] },
    { legs: [{ fromRequestId: 10, toRequestId: 20 }, { fromRequestId: 10, toRequestId: 20 }] },
    { legs: Array.from({ length: 9 }, (_, index) => ({ fromRequestId: 1, toRequestId: index + 2 })) },
  ]) {
    assertThrows(() => parseTravelInput(bad), TravelInputError);
  }
});

Deno.test("departure times are optional, normalized to ISO and must be real dates", () => {
  assertEquals(
    parseTravelInput({ legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: "2026-11-09T16:40:00Z" }] }),
    [{ fromRequestId: 10, toRequestId: 20, departureAt: DEPARTURE }],
  );
  assertThrows(
    () => parseTravelInput({ legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: "not a date" }] }),
    TravelInputError,
  );
});

Deno.test("Routes durations round up to whole minutes; no route is not zero", () => {
  assertEquals(minutesFromRoutesResponse({ routes: [{ duration: "754s" }] }), 13);
  assertEquals(minutesFromRoutesResponse({ routes: [{ duration: "0s" }] }), 0);
  assertEquals(minutesFromRoutesResponse({ routes: [{ duration: "60s" }] }), 1);
  assertEquals(minutesFromRoutesResponse({}), null);
  assertEquals(minutesFromRoutesResponse({ routes: [] }), null);
  assertEquals(minutesFromRoutesResponse({ routes: [{ duration: "100000s" }] }), null);
});

Deno.test("route details read traffic and static durations and distance in miles", () => {
  assertEquals(routeDetailsFromResponse({
    routes: [{ duration: "1380s", staticDuration: "1200s", distanceMeters: 8046.72 }],
  }), { minutes: 23, staticMinutes: 20, distanceMiles: 5 });
  assertEquals(routeDetailsFromResponse({ routes: [{ duration: "60s" }] }), {
    minutes: 1, staticMinutes: 1, distanceMiles: null,
  });
  assertEquals(routeDetailsFromResponse({ routes: [{ staticDuration: "60s" }] }), null);
});

Deno.test("traffic requests ask for the departure time and model; unaware requests do not", () => {
  const origin = { latitude: 1, longitude: 2 };
  const destination = { latitude: 3, longitude: 4 };
  const traffic = routesRequestBody(origin, destination, { model: "PESSIMISTIC", departureAt: DEPARTURE });
  assertEquals(traffic.routingPreference, "TRAFFIC_AWARE_OPTIMAL");
  assertEquals(traffic.departureTime, DEPARTURE);
  assertEquals(traffic.trafficModel, "PESSIMISTIC");
  const unaware = routesRequestBody(origin, destination);
  assertEquals(unaware.routingPreference, "TRAFFIC_UNAWARE");
  assert(!("departureTime" in unaware));
  assert(!("trafficModel" in unaware));
});

Deno.test("a stored estimate wins and Google is not called", async () => {
  const { fetcher, calls } = fakeRoutes([]);
  const { results, rowsToStore, rowsToReplace } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20 }], requests, apiKey: "key", fetcher, actorId: "user", now: NOW,
    stored: [{ from_request_id: 10, to_request_id: 20, minutes: 7, source: "MANUAL" }],
    trafficMode: "BEST_GUESS",
  });
  assertEquals(results, [{
    fromRequestId: 10, toRequestId: 20, minutes: 7, source: "MANUAL", status: "STORED",
    staticMinutes: null, distanceMiles: null, trafficModel: null, trafficDepartureAt: null,
  }]);
  assertEquals(rowsToStore, []);
  assertEquals(rowsToReplace, []);
  assertEquals(calls.length, 0);
});

Deno.test("a reused traffic estimate returns its traffic details", async () => {
  const { fetcher, calls } = fakeRoutes([]);
  const { results } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: SAME_SLOT }],
    requests,
    stored: [{
      from_request_id: 10, to_request_id: 20, minutes: 30, source: "ROUTES_API",
      static_minutes: 23, distance_miles: "5.0", traffic_model: "BEST_GUESS", departure_at: DEPARTURE,
    }],
    apiKey: "key", fetcher, actorId: "user", trafficMode: "BEST_GUESS", now: NOW,
  });
  assertEquals(results[0], {
    fromRequestId: 10, toRequestId: 20, departureAt: SAME_SLOT, minutes: 30, source: "ROUTES_API", status: "STORED",
    staticMinutes: 23, distanceMiles: 5, trafficModel: "BEST_GUESS", trafficDepartureAt: DEPARTURE,
  });
  assertEquals(calls.length, 0);
});

Deno.test("a new leg is calculated with the key in a header and stored as ROUTES_API", async () => {
  const { fetcher, calls } = fakeRoutes([Response.json({ routes: [{ duration: "1130s" }] })]);
  const { results, rowsToStore } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20 }], requests, stored: [], apiKey: "key", fetcher, actorId: "user",
  });
  assertEquals(results[0], {
    fromRequestId: 10, toRequestId: 20, minutes: 19, source: "ROUTES_API", status: "CALCULATED",
    staticMinutes: 19, distanceMiles: null, trafficModel: null, trafficDepartureAt: null,
  });
  assertEquals(rowsToStore, [{
    from_request_id: 10,
    to_request_id: 20,
    minutes: 19,
    source: "ROUTES_API",
    static_minutes: 19,
    distance_miles: null,
    departure_at: null,
    traffic_model: null,
    created_by: "user",
    updated_by: "user",
  }]);
  assertEquals(calls[0].url, ROUTES_ENDPOINT);
  const headers = calls[0].init.headers as Record<string, string>;
  assertEquals(headers["X-Goog-Api-Key"], "key");
  assertEquals(headers["X-Goog-FieldMask"], ROUTES_FIELD_MASK);
  assertEquals(sentBody(calls[0]).origin, {
    location: { latLng: { latitude: 33.97788205770745, longitude: -117.34520765941319 } },
  });
});

Deno.test("traffic off asks for traffic-unaware minutes and still stores the distance", async () => {
  const { fetcher, calls } = fakeRoutes([
    Response.json({ routes: [{ duration: "1380s", staticDuration: "1200s", distanceMeters: 8046.72 }] }),
  ]);
  const { rowsToStore } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: DEPARTURE }],
    requests, stored: [], apiKey: "key", fetcher, actorId: "user", trafficMode: "OFF", now: NOW,
  });
  const body = sentBody(calls[0]);
  assertEquals(body.routingPreference, "TRAFFIC_UNAWARE");
  assert(!("departureTime" in body));
  assertEquals(rowsToStore, [{
    from_request_id: 10,
    to_request_id: 20,
    minutes: 23,
    source: "ROUTES_API",
    static_minutes: 20,
    distance_miles: 5,
    departure_at: null,
    traffic_model: null,
    created_by: "user",
    updated_by: "user",
  }]);
});

Deno.test("traffic on asks for traffic at the planned departure time", async () => {
  const { fetcher, calls } = fakeRoutes([
    Response.json({ routes: [{ duration: "1800s", staticDuration: "1380s", distanceMeters: 8046.72 }] }),
  ]);
  const { results, rowsToStore } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: DEPARTURE }],
    requests, stored: [], apiKey: "key", fetcher, actorId: "user", trafficMode: "BEST_GUESS", now: NOW,
  });
  const body = sentBody(calls[0]);
  assertEquals(body.routingPreference, "TRAFFIC_AWARE_OPTIMAL");
  assertEquals(body.departureTime, DEPARTURE);
  assertEquals(body.trafficModel, "BEST_GUESS");
  assertEquals(results[0].minutes, 30);
  assertEquals(rowsToStore[0].static_minutes, 23);
  assertEquals(rowsToStore[0].departure_at, DEPARTURE);
  assertEquals(rowsToStore[0].traffic_model, "BEST_GUESS");
});

Deno.test("traffic falls back to unaware when there is no departure or it has already passed", async () => {
  const { fetcher, calls } = fakeRoutes([
    Response.json({ routes: [{ duration: "600s" }] }),
    Response.json({ routes: [{ duration: "600s" }] }),
  ]);
  const { rowsToStore } = await resolveTravelLegs({
    legs: [
      { fromRequestId: 10, toRequestId: 20 },
      { fromRequestId: 20, toRequestId: 10, departureAt: "2026-11-09T14:00:00.000Z" },
    ],
    requests, stored: [], apiKey: "key", fetcher, actorId: "user", trafficMode: "BEST_GUESS", now: NOW,
  });
  assertEquals(calls.map((call) => sentBody(call).routingPreference), ["TRAFFIC_UNAWARE", "TRAFFIC_UNAWARE"]);
  assertEquals(rowsToStore.map((row) => row.traffic_model), [null, null]);
});

Deno.test("a traffic estimate is reused within the same 30-minute departure slot", async () => {
  const { fetcher, calls } = fakeRoutes([]);
  const { results, rowsToReplace } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: SAME_SLOT }],
    requests,
    stored: [{
      from_request_id: 10, to_request_id: 20, minutes: 23, source: "ROUTES_API",
      traffic_model: "BEST_GUESS", departure_at: DEPARTURE,
    }],
    apiKey: "key", fetcher, actorId: "user", trafficMode: "BEST_GUESS", now: NOW,
  });
  assertEquals(results[0].status, "STORED");
  assertEquals(rowsToReplace, []);
  assertEquals(calls.length, 0);
});

Deno.test("a traffic estimate is recalculated when the departure moves to another slot", async () => {
  const { fetcher, calls } = fakeRoutes([Response.json({ routes: [{ duration: "2100s" }] })]);
  const { results, rowsToStore, rowsToReplace } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: OTHER_SLOT }],
    requests,
    stored: [{
      from_request_id: 10, to_request_id: 20, minutes: 23, source: "ROUTES_API",
      traffic_model: "BEST_GUESS", departure_at: DEPARTURE,
    }],
    apiKey: "key", fetcher, actorId: "user", trafficMode: "BEST_GUESS", now: NOW,
  });
  assertEquals(calls.length, 1);
  assertEquals(sentBody(calls[0]).departureTime, OTHER_SLOT);
  assertEquals(results[0].status, "CALCULATED");
  assertEquals(rowsToStore, []);
  assertEquals(rowsToReplace.map((row) => [row.from_request_id, row.to_request_id, row.minutes]), [[10, 20, 35]]);
});

Deno.test("turning traffic on recalculates an unaware estimate; turning it off reuses it", async () => {
  const stored = [{ from_request_id: 10, to_request_id: 20, minutes: 23, source: "ROUTES_API", traffic_model: null, departure_at: null }];
  const turnedOn = fakeRoutes([Response.json({ routes: [{ duration: "1500s" }] })]);
  const on = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: DEPARTURE }],
    requests, stored, apiKey: "key", fetcher: turnedOn.fetcher, actorId: "user", trafficMode: "PESSIMISTIC", now: NOW,
  });
  assertEquals(turnedOn.calls.length, 1);
  assertEquals(on.rowsToReplace.length, 1);

  const off = fakeRoutes([]);
  const unchanged = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20 }],
    requests, stored, apiKey: "key", fetcher: off.fetcher, actorId: "user", trafficMode: "OFF", now: NOW,
  });
  assertEquals(off.calls.length, 0);
  assertEquals(unchanged.results[0].status, "STORED");
});

Deno.test("manual minutes are never recalculated, even when the traffic moved", async () => {
  const { fetcher, calls } = fakeRoutes([]);
  const { results, rowsToReplace } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: OTHER_SLOT }],
    requests,
    stored: [{
      from_request_id: 10, to_request_id: 20, minutes: 40, source: "MANUAL",
      traffic_model: null, departure_at: null,
    }],
    apiKey: "key", fetcher, actorId: "user", trafficMode: "BEST_GUESS", now: NOW,
  });
  assertEquals(results[0], {
    fromRequestId: 10, toRequestId: 20, departureAt: OTHER_SLOT, minutes: 40, source: "MANUAL", status: "STORED",
    staticMinutes: null, distanceMiles: null, trafficModel: null, trafficDepartureAt: null,
  });
  assertEquals(rowsToReplace, []);
  assertEquals(calls.length, 0);
});

Deno.test("a failed refresh keeps the saved minutes instead of returning nothing", async () => {
  const { fetcher } = fakeRoutes([Response.json({ error: { status: "UNAVAILABLE", message: "down" } }, { status: 503 })]);
  const { results, rowsToReplace } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20, departureAt: OTHER_SLOT }],
    requests,
    stored: [{
      from_request_id: 10, to_request_id: 20, minutes: 23, source: "ROUTES_API",
      traffic_model: "BEST_GUESS", departure_at: DEPARTURE,
    }],
    apiKey: "key", fetcher, actorId: "user", trafficMode: "BEST_GUESS", now: NOW,
  });
  assertEquals(results[0].status, "STORED");
  assertEquals(results[0].minutes, 23);
  assert(results[0].message?.includes("saved value is kept"));
  assertEquals(rowsToReplace, []);
});

Deno.test("missing coordinates, unknown requests and Google failures give no minutes", async () => {
  const { fetcher, calls } = fakeRoutes([
    Response.json({ error: { status: "PERMISSION_DENIED", message: "denied" } }, { status: 403 }),
    Response.json({}),
  ]);
  const { results, rowsToStore } = await resolveTravelLegs({
    legs: [
      { fromRequestId: 10, toRequestId: 30 },
      { fromRequestId: 10, toRequestId: 99 },
      { fromRequestId: 10, toRequestId: 20 },
      { fromRequestId: 20, toRequestId: 10 },
    ],
    requests, stored: [], apiKey: "key", fetcher, actorId: "user",
  });
  assertEquals(results.map((result) => [result.status, result.minutes]), [
    ["MISSING_COORDINATES", null], ["NOT_FOUND", null], ["FAILED", null], ["NO_ROUTE", null],
  ]);
  assert(results[0].message?.startsWith("CS-0030 has no coordinates."));
  assertEquals(rowsToStore, []);
  assertEquals(calls.length, 2);
});

Deno.test("without the secret nothing is requested from Google", async () => {
  const { fetcher, calls } = fakeRoutes([]);
  const { results } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20 }], requests, stored: [], apiKey: undefined, fetcher, actorId: "user",
  });
  assertEquals(results[0].status, "FAILED");
  assertEquals(calls.length, 0);
});
