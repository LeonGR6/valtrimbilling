import { assert, assertEquals } from "@std/assert";
import {
  buildTiebreakRequest,
  LLM_ENDPOINT,
  mistralTiebreak,
  parseTiebreakAnswer,
  tiebreakLines,
} from "./releaseLlm.ts";
import type { ReleaseType } from "./releaseTypes.ts";

const progress: ReleaseType[] = [
  "ConditionalWaiverAndReleaseOnProgressPayment",
  "UnconditionalWaiverAndReleaseOnProgressPayment",
];

Deno.test("only a few short lines are sent and every digit is masked", () => {
  const lines = Array.from({ length: 20 }, (_, index) =>
    `Invoice 12${index} total $1,250.00 ${"x".repeat(300)}`
  );
  const sent = tiebreakLines(lines);
  assertEquals(sent.length, 8);
  assert(sent.every((line) => line.length <= 160));
  assert(sent.every((line) => !/\d/u.test(line)));
  assert(sent[0].includes("###"));
});

Deno.test("the request asks for JSON, temperature 0 and only the candidate types", () => {
  const request = buildTiebreakRequest({
    lines: ["CONDITIONAL AND UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT"],
    candidates: progress,
  });
  assertEquals(request.response_format, { type: "json_object" });
  assertEquals(request.temperature, 0);
  const user = request.messages[1].content;
  assert(user.includes(progress[0]) && user.includes(progress[1]));
  assert(!user.includes("OnFinalPayment"));
});

Deno.test("answers are accepted only for allowed types", () => {
  assertEquals(
    parseTiebreakAnswer(
      JSON.stringify({ release_type: progress[1], confidence: 0.9 }),
      progress,
    ),
    { releaseType: progress[1], confidence: 0.9 },
  );
  assertEquals(
    parseTiebreakAnswer(
      JSON.stringify({ release_type: "ConditionalWaiverAndReleaseOnFinalPayment", confidence: 1 }),
      progress,
    ),
    null,
  );
  assertEquals(parseTiebreakAnswer(JSON.stringify({ release_type: null }), progress), null);
  assertEquals(parseTiebreakAnswer("not json", progress), null);
  assertEquals(parseTiebreakAnswer(undefined, progress), null);
  assertEquals(parseTiebreakAnswer('"text"', progress), null);
});

Deno.test("confidence is clamped to 0-1 and defaults to 0", () => {
  const over = parseTiebreakAnswer(
    JSON.stringify({ release_type: progress[0], confidence: 7 }),
    progress,
  );
  assertEquals(over?.confidence, 1);
  const missing = parseTiebreakAnswer(
    JSON.stringify({ release_type: progress[0] }),
    progress,
  );
  assertEquals(missing?.confidence, 0);
});

Deno.test("the tie-breaker returns the model answer", async () => {
  let url = "";
  const fetcher = ((requested: string) => {
    url = requested;
    return Promise.resolve(
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ release_type: progress[1], confidence: 0.8 }),
          },
        }],
      })),
    );
  }) as unknown as typeof fetch;

  const answer = await mistralTiebreak({ apiKey: "key", fetcher })({
    lines: ["title"],
    candidates: progress,
  });
  assertEquals(url, LLM_ENDPOINT);
  assertEquals(answer, { releaseType: progress[1], confidence: 0.8 });
});

Deno.test("the tie-breaker never throws: no key, HTTP errors and network errors return null", async () => {
  const input = { lines: ["title"], candidates: progress };
  assertEquals(await mistralTiebreak({ apiKey: undefined })(input), null);

  const failing = (() => Promise.resolve(new Response("x", { status: 500 }))) as unknown as typeof fetch;
  assertEquals(await mistralTiebreak({ apiKey: "key", fetcher: failing })(input), null);

  const broken = (() => Promise.reject(new TypeError("down"))) as unknown as typeof fetch;
  assertEquals(await mistralTiebreak({ apiKey: "key", fetcher: broken })(input), null);
});
