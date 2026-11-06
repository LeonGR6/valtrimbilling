import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  minutesFromRoutesResponse,
  parseTravelInput,
  type RequestLocationRow,
  resolveTravelLegs,
  ROUTES_ENDPOINT,
  routesRequestBody,
  TravelInputError,
} from "./customerServiceTravel.ts";

const requests: RequestLocationRow[] = [
  { id: 10, folio: "CS-0010", service_properties: { latitude: "33.977882057707450", longitude: "-117.345207659413190" } },
  { id: 20, folio: "CS-0020", service_properties: { latitude: 33.986588, longitude: -117.343021 } },
  { id: 30, folio: "CS-0030", service_properties: { latitude: null, longitude: null } },
];

function fakeRoutes(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift() ?? new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
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

Deno.test("Routes durations round up to whole minutes; no route is not zero", () => {
  assertEquals(minutesFromRoutesResponse({ routes: [{ duration: "754s" }] }), 13);
  assertEquals(minutesFromRoutesResponse({ routes: [{ duration: "0s" }] }), 0);
  assertEquals(minutesFromRoutesResponse({ routes: [{ duration: "60s" }] }), 1);
  assertEquals(minutesFromRoutesResponse({}), null);
  assertEquals(minutesFromRoutesResponse({ routes: [] }), null);
  assertEquals(minutesFromRoutesResponse({ routes: [{ duration: "100000s" }] }), null);
  assertEquals(routesRequestBody({ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }).routingPreference, "TRAFFIC_UNAWARE");
});

Deno.test("a stored estimate wins and Google is not called", async () => {
  const { fetcher, calls } = fakeRoutes([]);
  const { results, rowsToStore } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20 }], requests, apiKey: "key", fetcher, actorId: "user",
    stored: [{ from_request_id: 10, to_request_id: 20, minutes: 7, source: "MANUAL" }],
  });
  assertEquals(results, [{ fromRequestId: 10, toRequestId: 20, minutes: 7, source: "MANUAL", status: "STORED" }]);
  assertEquals(rowsToStore, []);
  assertEquals(calls.length, 0);
});

Deno.test("a new leg is calculated with the key in a header and stored as ROUTES_API", async () => {
  const { fetcher, calls } = fakeRoutes([Response.json({ routes: [{ duration: "1130s" }] })]);
  const { results, rowsToStore } = await resolveTravelLegs({
    legs: [{ fromRequestId: 10, toRequestId: 20 }], requests, stored: [], apiKey: "key", fetcher, actorId: "user",
  });
  assertEquals(results[0], { fromRequestId: 10, toRequestId: 20, minutes: 19, source: "ROUTES_API", status: "CALCULATED" });
  assertEquals(rowsToStore, [{
    from_request_id: 10, to_request_id: 20, minutes: 19, source: "ROUTES_API", created_by: "user", updated_by: "user",
  }]);
  assertEquals(calls[0].url, ROUTES_ENDPOINT);
  const headers = calls[0].init.headers as Record<string, string>;
  assertEquals(headers["X-Goog-Api-Key"], "key");
  assertEquals(headers["X-Goog-FieldMask"], "routes.duration");
  const body = JSON.parse(String(calls[0].init.body));
  assertEquals(body.origin.location.latLng, { latitude: 33.97788205770745, longitude: -117.34520765941319 });
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
