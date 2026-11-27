import { assertEquals } from "@std/assert";
import { withCustomerServiceEmailScheduledDispatch } from "./customerServiceEmailScheduledDispatch.ts";

const secret = "test-only-automation-key-12345678901234567890";
const id = "10000000-0000-0000-0000-000000000001";
const target = "20000000-0000-0000-0000-000000000002";
const now = 1_798_000_000_000;
async function signed(
  kind = "SYNC",
  overrides: {
    target?: string;
    expires?: number;
    body?: unknown;
    id?: string;
  } = {},
) {
  const expires = overrides.expires ?? now + 180_000;
  const invocation = overrides.id ?? id;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `${invocation}:${kind}:${expires}:${overrides.target ?? target}`,
    ),
  );
  return new Request("https://example.test/sync", {
    method: "POST",
    headers: {
      "x-valtrim-email-dispatch": invocation,
      "x-valtrim-email-dispatch-expires": String(expires),
      "x-valtrim-email-dispatch-signature": [...new Uint8Array(signature)].map((
        v,
      ) => v.toString(16).padStart(2, "0")).join(""),
    },
    body: JSON.stringify(
      overrides.body ??
        {
          [kind === "WORKER" ? "importId" : "connectionId"]: overrides.target ??
            target,
        },
    ),
  });
}
function fixture() {
  const consumed: unknown[] = [];
  const handled: unknown[] = [];
  let used = false;
  const handler = withCustomerServiceEmailScheduledDispatch({
    kind: "SYNC",
    secret,
    now: () => now,
    consume: (identity) => {
      consumed.push(identity);
      const fresh = !used;
      used = true;
      return Promise.resolve(fresh);
    },
    handler: async (request) => {
      handled.push({
        body: await request.json(),
        secret: request.headers.get("x-valtrim-email-sync-secret"),
      });
      return Response.json({ status: "ROUND_COMPLETE" });
    },
  });
  return { handler, consumed, handled };
}
Deno.test("Scheduled HMAC invokes the existing handler once and consumes before processing", async () => {
  const f = fixture();
  assertEquals((await f.handler(await signed())).status, 200);
  assertEquals(f.consumed, [{
    p_invocation_id: id,
    p_kind: "SYNC",
    p_target_id: target,
    p_expires_ms: now + 180_000,
  }]);
  assertEquals(f.handled, [{ body: { connectionId: target }, secret }]);
  assertEquals((await f.handler(await signed())).status, 401);
  assertEquals(f.handled.length, 1);
});
Deno.test("Scheduled calls bind endpoint, body target and expiry and reject extra recovery operations", async () => {
  const f = fixture();
  for (
    const request of [
      await signed("WORKER"),
      await signed("RECONCILE"),
      await signed("SYNC", { expires: now }),
      await signed("SYNC", { expires: now + 900_000 }),
      await signed("SYNC", { body: { connectionId: id } }),
      await signed("SYNC", {
        body: { connectionId: target, sourceRecovery: {} },
      }),
    ]
  ) assertEquals((await f.handler(request)).status, 401);
  assertEquals(f.consumed.length, 0);
  assertEquals(f.handled.length, 0);
});
Deno.test("Incomplete, forged and oversized scheduled calls never reach the database", async () => {
  const f = fixture();
  const request = await signed();
  const headers = new Headers(request.headers);
  headers.set("x-valtrim-email-dispatch-signature", "0".repeat(64));
  assertEquals(
    (await f.handler(
      new Request(request.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ connectionId: target }),
      }),
    )).status,
    401,
  );
  headers.delete("x-valtrim-email-dispatch-expires");
  assertEquals(
    (await f.handler(
      new Request(request.url, { method: "POST", headers, body: "{}" }),
    )).status,
    401,
  );
  assertEquals(
    (await f.handler(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: "x".repeat(1025),
      }),
    )).status,
    401,
  );
  assertEquals(f.consumed.length, 0);
});
Deno.test("A failed dispatch receipt is visible and cannot proceed to Graph", async () => {
  let ran = false;
  const handler = withCustomerServiceEmailScheduledDispatch({
    kind: "SYNC",
    secret,
    now: () => now,
    consume: () => Promise.reject(new Error("raw private diagnostic")),
    handler: () => {
      ran = true;
      return Promise.resolve(Response.json({}));
    },
  });
  const response = await handler(await signed());
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    error: "SCHEDULED_DISPATCH_NOT_CONFIRMED",
  });
  assertEquals(ran, false);
});
Deno.test("Manual secret-authenticated requests retain their existing handler contract", async () => {
  const f = fixture();
  assertEquals(
    (await f.handler(
      new Request("https://example.test/sync", {
        method: "POST",
        headers: { "x-valtrim-email-sync-secret": secret },
        body: JSON.stringify({ connectionId: target }),
      }),
    )).status,
    200,
  );
  assertEquals(f.consumed.length, 0);
  assertEquals(f.handled.length, 1);
});
