import { assertEquals, assertRejects } from "@std/assert";
import { readSpconnectMessages, SpconnectReadError } from "./spconnectMessages.ts";

const URL_BASE = "https://teammate.supabase.co";

function fakeFetch(response: Response, calls: { url: string; headers: Headers }[] = []) {
  return (async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    return response;
  }) as unknown as typeof fetch;
}

Deno.test("the messages are read newest first with the secret key on the server", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const rows = [{ id: 2, received_at: "2026-11-24T10:00:00Z" }, { id: 1, received_at: "2026-11-20T18:11:45Z" }];
  const messages = await readSpconnectMessages({
    url: URL_BASE,
    secretKey: "sb_secret_test",
    fetcher: fakeFetch(Response.json(rows), calls),
  });

  assertEquals(messages, rows);
  assertEquals(
    calls[0].url,
    `${URL_BASE}/rest/v1/spconnect_messages_uat?select=*&order=received_at.desc&limit=200`,
  );
  assertEquals(calls[0].headers.get("apikey"), "sb_secret_test");
});

Deno.test("without the URL or the key it explains what the server is missing", async () => {
  const error = await assertRejects(
    () => readSpconnectMessages({ url: URL_BASE, secretKey: "" }),
    SpconnectReadError,
  );
  assertEquals(error.status, 503);
});

Deno.test("a missing view, a rejected key and other answers become clear errors", async () => {
  const cases: [number, string][] = [
    [404, "does not have the private spconnect_messages_uat view yet"],
    [401, "rejected the server key"],
    [403, "rejected the server key"],
    [500, "answered with status 500"],
  ];
  for (const [status, text] of cases) {
    const error = await assertRejects(
      () => readSpconnectMessages({ url: URL_BASE, secretKey: "sb_secret_test", fetcher: fakeFetch(new Response("{}", { status })) }),
      SpconnectReadError,
    );
    assertEquals(error.status, 502);
    assertEquals(error.message.includes(text), true, error.message);
  }
});

Deno.test("an unreachable project is reported without details", async () => {
  const fetcher = (() => Promise.reject(new TypeError("dns error"))) as unknown as typeof fetch;
  const error = await assertRejects(
    () => readSpconnectMessages({ url: URL_BASE, secretKey: "sb_secret_test", fetcher }),
    SpconnectReadError,
  );
  assertEquals(error.message, "Could not reach the Hyphen UAT project. Try again in a moment.");
});
