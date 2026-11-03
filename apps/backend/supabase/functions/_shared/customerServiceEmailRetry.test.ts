import { assertEquals, assertStringIncludes } from "@std/assert";
import { createCustomerServiceEmailRetryHandler } from "./customerServiceEmailRetry.ts";
import retryConfig from "../customer-service-email-retry/deno.json" with { type: "json" };
import sharedConfig from "../deno.json" with { type: "json" };

const id = "ea7461c0-0b79-4bc9-85bf-fa6910fd7d5b";
const version = "2026-10-23T18:05:00.123456+00:00";
function request(body: unknown = { importId: id, expectedUpdatedAt: version }) {
  return new Request("https://app.test/retry", { method: "POST", body: JSON.stringify(body) });
}
function fixture(overrides: Partial<Parameters<typeof createCustomerServiceEmailRetryHandler>[0]> = {}) {
  const calls: string[] = [];
  const actor = {
    queue: (importId: string, expected: string) => {
      calls.push(`queue:${importId}:${expected}`);
      return Promise.resolve({ importId, requestId: null, status: "PENDING" });
    },
    hold: (importId: string) => {
      calls.push("hold");
      return Promise.resolve({ importId, requestId: null, status: "NEEDS_ATTENTION", errorCode: "WORKER_CONTINUATION_REQUIRED" });
    },
  };
  const handler = createCustomerServiceEmailRetryHandler({
    authorize: () => { calls.push("authorize"); return Promise.resolve(actor); },
    enabled: true, hasProviderKey: true,
    run: (importId) => { calls.push(`run:${importId}`); return Promise.resolve({ importId, requestId: 596, status: "PROCESSED" }); },
    ...overrides,
  });
  return { handler, calls, actor };
}

Deno.test("retry deployment uses the same pinned imports as the existing worker", () => {
  assertEquals(retryConfig.imports, sharedConfig.imports);
});
Deno.test("an authenticated retry forwards only the exact import and version, never a browser worker secret", async () => {
  const { handler, calls } = fixture();
  const response = await handler(request());
  assertEquals(response.status, 200);
  assertEquals((await response.json()).requestId, 596);
  assertEquals(calls, ["authorize", `queue:${id}:${version}`, `run:${id}`]);
});
Deno.test("wrong methods never authenticate or execute work", async () => {
  const { handler, calls } = fixture();
  assertEquals((await handler(new Request("https://app.test"))).status, 405);
  assertEquals(calls, []);
});
Deno.test("unauthenticated, inactive and denied actors cannot queue or execute work", async () => {
  for (const status of [401, 403]) {
    const { handler, calls } = fixture({ authorize: () => Promise.resolve(Response.json({ error: "Denied" }, { status })) });
    assertEquals((await handler(request())).status, status);
    assertEquals(calls, []);
  }
});
Deno.test("disabled worker and missing provider fail before changing queue state", async () => {
  for (const [overrides, status] of [[{ enabled: false }, 409], [{ hasProviderKey: false }, 503]] as const) {
    const { handler, calls } = fixture(overrides);
    assertEquals((await handler(request())).status, status);
    assertEquals(calls, ["authorize"]);
  }
});
Deno.test("empty, malformed and unexpected fields cannot consume arbitrary queued mail", async () => {
  for (const body of [null, [], {}, { importId: id }, { importId: null, expectedUpdatedAt: version },
    { importId: "bad", expectedUpdatedAt: version }, { importId: id, expectedUpdatedAt: "yesterday" },
    { importId: id, expectedUpdatedAt: version, secret: "forged" }]) {
    const { handler, calls } = fixture();
    assertEquals((await handler(request(body))).status, 400);
    assertEquals(calls, ["authorize"]);
  }
});
Deno.test("JSON parse and streaming byte limits are enforced before queuing", async () => {
  for (const [body, status] of [["not-json", 400], ["x".repeat(2049), 413]] as const) {
    const { handler, calls } = fixture();
    assertEquals((await handler(new Request("https://app.test", { method: "POST", body }))).status, status);
    assertEquals(calls, ["authorize"]);
  }
});
Deno.test("SQL permission, stale-version, unavailable-source and missing-import errors never call AI", async () => {
  for (const [code, status] of [["42501", 403], ["40001", 409], ["55000", 409], ["P0002", 404]] as const) {
    const { handler, calls } = fixture({ authorize: () => Promise.resolve({
      queue: () => Promise.reject({ code, message: "private diagnostic" }), hold: () => Promise.reject(new Error()),
    }) });
    const response = await handler(request());
    assertEquals(response.status, status);
    assertEquals(calls, []);
    assertEquals((await response.text()).includes("private diagnostic"), false);
  }
});
Deno.test("an existing linked request is returned without repeating inference", async () => {
  const { handler, calls } = fixture({ authorize: () => Promise.resolve({
    queue: () => Promise.resolve({ importId: id, status: "PROCESSED", requestId: 596 }),
    hold: () => Promise.reject(new Error()),
  }) });
  assertEquals((await (await handler(request())).json()).requestId, 596);
  assertEquals(calls, []);
});
Deno.test("a not-yet-due retry does not bypass its durable wait", async () => {
  const { handler, calls } = fixture({ now: () => 0, authorize: () => Promise.resolve({
    queue: () => Promise.resolve({ importId: id, requestId: null, status: "PENDING", nextAttemptAt: "2026-10-23T20:00:00Z" }),
    hold: () => Promise.resolve({ importId: id, requestId: null, status: "NEEDS_ATTENTION" }),
  }) });
  assertEquals((await (await handler(request())).json()).status, "NEEDS_ATTENTION");
  assertEquals(calls, []);
});
Deno.test("an occupied import cannot start a second worker", async () => {
  const { handler, calls } = fixture({ authorize: () => Promise.resolve({
    queue: () => Promise.resolve({ importId: id, requestId: null, status: "PROCESSING" }),
    hold: () => Promise.reject(new Error()),
  }) });
  assertEquals((await (await handler(request())).json()).status, "PROCESSING");
  assertEquals(calls, []);
});
Deno.test("yield, idle and lost lease are reconciled without being labeled successful requests", async () => {
  for (const status of ["PENDING", "IDLE", "LEASE_LOST"]) {
    const { handler, calls } = fixture({ run: () => Promise.resolve({ importId: id, requestId: null, status }) });
    const result = await (await handler(request())).json();
    assertEquals(result.status, "NEEDS_ATTENTION");
    assertEquals(result.requestId, null);
    assertEquals(calls.at(-1), "hold");
  }
});
Deno.test("unconfirmed execution failures surface no secrets and attempt safe reconciliation", async () => {
  const { handler, calls } = fixture({ run: () => Promise.reject(new Error("provider secret and signed url")) });
  const response = await handler(request());
  assertEquals(response.status, 503);
  assertStringIncludes((await response.json()).error, "No se confirmó");
  assertEquals(calls.at(-1), "hold");
});
