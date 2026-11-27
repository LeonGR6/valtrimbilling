import { assertEquals, assertRejects } from "@std/assert";
import {
  emailWorkerFetch,
  isTransientEmailImportError,
} from "./customerServiceEmailRuntime.ts";
import { MistralOcrError } from "./mistralOcr.ts";

Deno.test("worker retry classification distinguishes temporary transport/provider faults from invalid data", () => {
  for (
    const error of [
      new MistralOcrError("busy", 429),
      new MistralOcrError("offline", 503),
      new DOMException("timeout", "AbortError"),
      { code: "40001" },
      { statusCode: "503" },
      new TypeError("fetch failed"),
    ]
  ) {
    assertEquals(isTransientEmailImportError(error), true);
  }
  for (
    const error of [
      new MistralOcrError("invalid", 400),
      new MistralOcrError("key", 401),
      new Error("invalid PDF"),
      new TypeError("Invalid facts"),
      null,
      { code: "22023" },
    ]
  ) {
    assertEquals(isTransientEmailImportError(error), false);
  }
});
Deno.test("worker deadline rejects a new inference but still allows provider-file cleanup", async () => {
  let calls = 0;
  const fetcher: typeof fetch = () => {
    calls++;
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const bounded = emailWorkerFetch(1, fetcher, () => 2);
  await assertRejects(
    () => bounded("https://api.mistral.ai/v1/ocr"),
    DOMException,
  );
  assertEquals(
    (await bounded("https://api.mistral.ai/v1/files/test", {
      method: "DELETE",
    })).status,
    204,
  );
  assertEquals(calls, 1);
});
Deno.test("worker network deadline covers response body and leaves no timer", async () => {
  const bounded = emailWorkerFetch(
    100,
    (_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("timeout", "AbortError")), {
                once: true,
              });
            },
          }),
        ),
      ),
    () => 0,
    5,
  );
  await assertRejects(
    () => bounded("https://supabase.test/rest/v1/test"),
    DOMException,
  );
});
Deno.test("worker combines caller cancellation with its own request deadline", async () => {
  const caller = new AbortController();
  caller.abort();
  const bounded = emailWorkerFetch(100, (_input, init) => {
    assertEquals(init?.signal?.aborted, true);
    return Promise.reject(new DOMException("cancelled", "AbortError"));
  }, () => 0);
  await assertRejects(
    () => bounded("https://supabase.test", { signal: caller.signal }),
    DOMException,
  );
});
