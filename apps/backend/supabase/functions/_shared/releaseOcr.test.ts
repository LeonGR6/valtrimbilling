import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  cleanOcrMarkdown,
  OCR_ENDPOINT,
  OCR_MODEL,
  OcrError,
  ocrWithMistral,
} from "./releaseOcr.ts";

const pdfBytes = new TextEncoder().encode("%PDF-1.4 test");
const apiKey = "test-key-should-never-appear";

function respond(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function failureOf(fetcher: typeof fetch) {
  const error = await assertRejects(
    () => ocrWithMistral(pdfBytes, 1, { apiKey, fetcher }),
    OcrError,
  );
  return error as OcrError;
}

Deno.test("OCR refuses to run without an API key and says how to fix it", async () => {
  const error = await assertRejects(
    () => ocrWithMistral(pdfBytes, 1, { apiKey: undefined }),
    OcrError,
  ) as OcrError;
  assertEquals(error.failure, "not_configured");
  assert(error.message.includes("MISTRAL_API_KEY"));
});

Deno.test("OCR sends the PDF as a base64 data URL and only the first pages", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const fetcher = ((url: string, init: RequestInit) => {
    captured = { url, init };
    return Promise.resolve(respond({
      pages: [
        { index: 1, markdown: "## Second page" },
        { index: 0, markdown: "# **UNCONDITIONAL WAIVER**\n\nThrough Date:" },
      ],
    }));
  }) as unknown as typeof fetch;

  const pages = await ocrWithMistral(pdfBytes, 10, { apiKey, fetcher });

  assertEquals(captured!.url, OCR_ENDPOINT);
  const headers = captured!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, `Bearer ${apiKey}`);
  const body = JSON.parse(captured!.init.body as string);
  assertEquals(body.model, OCR_MODEL);
  assertEquals(body.pages, [0, 1, 2]);
  assertEquals(body.include_image_base64, false);
  assertEquals(body.document.type, "document_url");
  assert(body.document.document_url.startsWith("data:application/pdf;base64,JVBERi"));
  assertEquals(pages, [["UNCONDITIONAL WAIVER", "Through Date:"], ["Second page"]]);
});

Deno.test("a one page PDF asks for page 0 only", async () => {
  let pages: unknown;
  const fetcher = ((_url: string, init: RequestInit) => {
    pages = JSON.parse(init.body as string).pages;
    return Promise.resolve(respond({ pages: [{ index: 0, markdown: "x" }] }));
  }) as unknown as typeof fetch;
  await ocrWithMistral(pdfBytes, 1, { apiKey, fetcher });
  assertEquals(pages, [0]);
});

Deno.test("OCR failures map to fixed messages that never echo the key or the response", async () => {
  const cases: Array<[Response | Error, string]> = [
    [respond("secret body", 401), "auth"],
    [respond("secret body", 403), "auth"],
    [respond("secret body", 429), "rate_limited"],
    [respond("secret body", 500), "upstream"],
    [respond("not json at all", 200), "upstream"],
    [respond({ unexpected: true }, 200), "upstream"],
    [new DOMException("timed out", "TimeoutError"), "timeout"],
    [new TypeError("network down"), "upstream"],
  ];

  for (const [outcome, failure] of cases) {
    const fetcher = (() =>
      outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome)) as unknown as typeof fetch;
    const error = await failureOf(fetcher);
    assertEquals(error.failure, failure);
    assert(!error.message.includes(apiKey));
    assert(!error.message.includes("secret body"));
  }
});

Deno.test("OCR markdown becomes plain lines", () => {
  assertEquals(
    cleanOcrMarkdown(
      [
        "# CONDITIONAL WAIVER AND RELEASE ON **FINAL** PAYMENT",
        "",
        "> NOTICE: this document",
        "- Amount of Check: $\\_\\_\\_\\_",
        "| Through Date: | |",
        "![img-0.jpeg](img-0.jpeg)",
        "<!-- comment -->",
      ].join("\n"),
    ),
    [
      "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
      "NOTICE: this document",
      "Amount of Check: $____",
      "Through Date:",
    ],
  );
});
